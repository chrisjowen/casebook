import { describe, expect, it } from 'vitest';
import {
	birthRegistrationAbroad,
	incidentManagement,
	uncollectedFact
} from '../../fixtures/index.js';
import {
	createDraft,
	defaultCaseBinding,
	editDraft,
	InMemoryRevisionStore,
	NumberingConflictError,
	publish,
	publishDraft,
	publishesOnEdit,
	undoDraft,
	type Attribution,
	type DraftContext,
	type PrincipalRef,
	type PublishedVersion,
	type PublishRequest
} from '../../src/index.js';

const alice: Attribution = { author: { id: 'u-alice', kind: 'user' } };
const wizard: Attribution = {
	author: { id: 'a-wizard', kind: 'agent' },
	onBehalfOf: { id: 'u-alice', kind: 'user' }
};
const director: PrincipalRef = { id: 'u-director', kind: 'user' };
const at = new Date('2026-10-25T09:00:00Z');

const uncollect = {
	op: 'unlink',
	from: 'step.report-incident',
	edge: 'collects',
	to: 'fact.incident-summary'
} as const;

describe('change policies', () => {
	it('pins governed cases and lets living cases follow the latest version', () => {
		expect(defaultCaseBinding({ mode: 'governed' })).toBe('pinned');
		expect(defaultCaseBinding({ mode: 'living' })).toBe('follow-latest');
		expect(publishesOnEdit({ mode: 'governed', requiresApproval: true })).toBe(false);
		expect(publishesOnEdit({ mode: 'living' })).toBe(true);
	});
});

describe('publish', () => {
	it('publishes a governed definition that passes the checks as the next, frozen version', () => {
		const decision = publish({
			policy: { mode: 'governed' },
			document: birthRegistrationAbroad,
			revision: 7,
			publishedBy: alice.author,
			at
		});
		expect(decision).toEqual({
			allowed: true,
			version: {
				version: 1,
				document: { ...birthRegistrationAbroad, version: 1 },
				policy: 'governed',
				revision: 7,
				publishedBy: alice.author,
				publishedAt: '2026-10-25T09:00:00.000Z',
				issues: []
			}
		});
		const version = decision.allowed ? decision.version : undefined;
		expect(Object.isFrozen(version?.document.nodes[0]?.core)).toBe(true);
		expect(birthRegistrationAbroad.version).toBe(3);
		expect(Object.isFrozen(birthRegistrationAbroad)).toBe(false);
	});

	it('numbers a version after the latest one and refuses one that changes nothing', () => {
		const first = publish({
			policy: { mode: 'governed' },
			document: incidentManagement,
			publishedBy: alice.author
		});
		const latest = (first.allowed && first.version) as PublishedVersion;
		expect(
			publish({
				policy: { mode: 'governed' },
				document: incidentManagement,
				latest,
				publishedBy: alice.author
			})
		).toMatchObject({
			allowed: false,
			code: 'no-change',
			reason: 'Nothing has changed since version 1'
		});
		const changed = { ...incidentManagement, slug: 'incident-response' };
		const second = publish({
			policy: { mode: 'governed' },
			document: changed,
			latest,
			publishedBy: alice.author
		});
		expect(second).toMatchObject({
			allowed: true,
			version: { version: 2, document: { version: 2 } }
		});
	});

	it('refuses a governed publish while a check fails', () => {
		expect(
			publish({
				policy: { mode: 'governed' },
				document: uncollectedFact,
				publishedBy: alice.author
			})
		).toMatchObject({
			allowed: false,
			code: 'checks-failed',
			reason:
				'Fix these before publishing: fact.invoice-number is required by step.record-payment, but no step or decision collects it',
			issues: [expect.objectContaining({ code: 'uncollected-fact' })]
		});
	});

	it('requires an approval when the governed policy asks for one', () => {
		const policy = { mode: 'governed', requiresApproval: true } as const;
		expect(
			publish({ policy, document: incidentManagement, publishedBy: alice.author })
		).toMatchObject({
			allowed: false,
			code: 'approval-required'
		});
		expect(
			publish({
				policy,
				document: incidentManagement,
				publishedBy: alice.author,
				approvedBy: director
			})
		).toMatchObject({ allowed: true, version: { approvedBy: director } });
	});

	it('refuses a publish whose attribution breaks the rules for edits', () => {
		const cases: [Pick<PublishRequest, 'publishedBy' | 'onBehalfOf'>, string][] = [
			[{ publishedBy: wizard.author }, 'an agent must record who it acts on behalf of'],
			[
				{ publishedBy: { id: 's-sync', kind: 'service' } },
				'an service must record who it acts on behalf of'
			],
			[
				{ publishedBy: wizard.author, onBehalfOf: { id: 'a-other', kind: 'agent' } },
				'an agent cannot act on behalf of another agent'
			],
			[
				{ publishedBy: { id: 'g-ops', kind: 'group' } },
				'a group cannot author an edit; record the user or agent who made it'
			],
			[
				{ publishedBy: alice.author, onBehalfOf: director },
				'a user edits on their own behalf, so onBehalfOf must not be set'
			]
		];
		for (const [who, problem] of cases) {
			for (const mode of ['governed', 'living'] as const) {
				expect(publish({ policy: { mode }, document: incidentManagement, ...who })).toEqual({
					allowed: false,
					code: 'invalid-attribution',
					reason: `Cannot record this publish: ${problem}`,
					errors: [],
					issues: []
				});
			}
		}
	});

	it('accepts an approval only from a user other than the publisher and whoever they act for', () => {
		const policy = { mode: 'governed', requiresApproval: true } as const;
		const cases: [Omit<PublishRequest, 'policy' | 'document'>, string][] = [
			[
				{ publishedBy: alice.author, approvedBy: { id: 'a-reviewer', kind: 'agent' } },
				'an approval must come from a user, not a agent'
			],
			[
				{ publishedBy: alice.author, approvedBy: { id: 'g-ops', kind: 'group' } },
				'an approval must come from a user, not a group'
			],
			[
				{ publishedBy: alice.author, approvedBy: { id: 's-sync', kind: 'service' } },
				'an approval must come from a user, not a service'
			],
			[
				{ publishedBy: alice.author, approvedBy: alice.author },
				'the publisher cannot approve their own publish'
			],
			[
				{ ...{ publishedBy: wizard.author, onBehalfOf: alice.author }, approvedBy: alice.author },
				'u-alice cannot approve a publish made on their own behalf'
			]
		];
		for (const [who, problem] of cases) {
			expect(publish({ policy, document: incidentManagement, ...who })).toMatchObject({
				allowed: false,
				code: 'invalid-approval',
				reason: `Cannot accept this approval: ${problem}`
			});
		}
		expect(
			publish({
				policy,
				document: incidentManagement,
				publishedBy: wizard.author,
				onBehalfOf: alice.author,
				approvedBy: director
			})
		).toMatchObject({ allowed: true, version: { approvedBy: director } });
	});

	it('refuses to publish a revision older than the one the latest version holds', () => {
		const first = publish({
			policy: { mode: 'living' },
			document: incidentManagement,
			revision: 3,
			publishedBy: alice.author
		});
		const latest = (first.allowed && first.version) as PublishedVersion;
		expect(
			publish({
				policy: { mode: 'living' },
				document: { ...incidentManagement, slug: 'incident-response' },
				revision: 2,
				latest,
				publishedBy: alice.author
			})
		).toMatchObject({
			allowed: false,
			code: 'version-conflict',
			reason:
				'Version 1 already holds the newer revision 3, so revision 2 cannot be published after it'
		});
	});

	it('publishes a living definition despite failing checks, recording them', () => {
		const decision = publish({
			policy: { mode: 'living' },
			document: uncollectedFact,
			publishedBy: alice.author
		});
		expect(decision).toMatchObject({
			allowed: true,
			version: {
				version: 1,
				policy: 'living',
				issues: [expect.objectContaining({ code: 'uncollected-fact', severity: 'error' })]
			}
		});
	});

	it('never publishes a document that breaks the schema, under either policy', () => {
		const broken = { ...incidentManagement, slug: 'Not A Slug' };
		for (const mode of ['governed', 'living'] as const) {
			expect(
				publish({ policy: { mode }, document: broken, publishedBy: alice.author })
			).toMatchObject({
				allowed: false,
				code: 'schema-violation'
			});
		}
	});
});

describe('stored drafts', () => {
	function context(policy: DraftContext['policy']): DraftContext {
		return { store: new InMemoryRevisionStore(), definitionId: 'def-incident', policy };
	}

	it('governed: edits stay in the draft until an explicit publish', async () => {
		const draft = context({ mode: 'governed' });
		const created = await createDraft(draft, incidentManagement, alice, at);
		expect(created).toMatchObject({ ok: true, revision: { number: 1 } });
		expect(created).not.toHaveProperty('published');

		const edited = await editDraft(draft, [uncollect], wizard, at);
		expect(edited).toMatchObject({
			ok: true,
			revision: { number: 2, onBehalfOf: wizard.onBehalfOf }
		});
		expect(await draft.store.versions('def-incident')).toEqual([]);

		expect(await publishDraft(draft, { publishedBy: alice.author, at })).toMatchObject({
			allowed: false,
			code: 'checks-failed'
		});
		await undoDraft(draft, alice, at);
		const published = await publishDraft(draft, { publishedBy: alice.author, at });
		expect(published).toMatchObject({ allowed: true, version: { version: 1, revision: 3 } });
		expect(await draft.store.versions('def-incident')).toHaveLength(1);
	});

	it('living: every accepted edit publishes a new version, with checks recorded as warnings', async () => {
		const draft = context({ mode: 'living' });
		const created = await createDraft(draft, birthRegistrationAbroad, alice, at);
		expect(created).toMatchObject({ ok: true, published: { version: 1, issues: [] } });

		const edited = await editDraft(
			draft,
			[{ op: 'unlink', from: 'step.register-locally', edge: 'collects', to: 'fact.child-name' }],
			wizard,
			at
		);
		expect(edited).toMatchObject({
			ok: true,
			revision: { number: 2 },
			published: {
				version: 2,
				revision: 2,
				publishedBy: wizard.author,
				onBehalfOf: wizard.onBehalfOf,
				issues: [expect.objectContaining({ code: 'uncollected-fact', severity: 'error' })]
			}
		});

		const rejected = await editDraft(
			draft,
			[{ op: 'remove_node', id: 'fact.child-name' }],
			alice,
			at
		);
		expect(rejected).toMatchObject({ ok: false, code: 'referenced' });

		const undone = await undoDraft(draft, alice, at);
		expect(undone).toMatchObject({
			ok: true,
			revision: { number: 3, revertedTo: 1 },
			published: { version: 3, issues: [] }
		});
		expect((await draft.store.versions('def-incident')).map((v) => v.version)).toEqual([1, 2, 3]);
		expect(await draft.store.revisions('def-incident')).toHaveLength(3);
	});

	it('refuses a stored publish by an agent acting for nobody, storing nothing', async () => {
		const draft = context({ mode: 'governed' });
		await createDraft(draft, incidentManagement, alice, at);
		expect(await publishDraft(draft, { publishedBy: wizard.author, at })).toMatchObject({
			allowed: false,
			code: 'invalid-attribution'
		});
		expect(await draft.store.versions('def-incident')).toEqual([]);
	});

	it('living: publishes the revision each edit committed, and reports a lost race instead of throwing', async () => {
		let interleave: (() => Promise<unknown>) | undefined;
		class InterleavingStore extends InMemoryRevisionStore {
			override async latestVersion(definitionId: string) {
				const latest = await super.latestVersion(definitionId);
				const other = interleave;
				interleave = undefined;
				await other?.();
				return latest;
			}
		}
		const draft: DraftContext = {
			store: new InterleavingStore(),
			definitionId: 'def-incident',
			policy: { mode: 'living' }
		};
		await createDraft(draft, incidentManagement, alice, at);
		const bob: Attribution = { author: { id: 'u-bob', kind: 'user' } };
		let bobs: Awaited<ReturnType<typeof editDraft>> | undefined;
		interleave = async () => {
			bobs = await editDraft(draft, [{ op: 'remove_node', id: 'step.notify-downstream' }], bob, at);
		};

		const alices = await editDraft(draft, [uncollect], alice, at);

		const revisions = await draft.store.revisions('def-incident');
		expect(revisions.map((r) => r.author.id)).toEqual(['u-alice', 'u-alice', 'u-bob']);
		expect(bobs).toMatchObject({
			ok: true,
			revision: { number: 3 },
			published: { version: 2, revision: 3, publishedBy: bob.author }
		});
		const versions = await draft.store.versions('def-incident');
		expect(versions.map((v) => [v.version, v.revision, v.publishedBy.id])).toEqual([
			[1, 1, 'u-alice'],
			[2, 3, 'u-bob']
		]);
		expect(versions[1]?.document.nodes).toEqual(
			revisions[2]?.document.nodes.map((n) => expect.objectContaining({ core: n.core }))
		);
		expect(alices).toMatchObject({
			ok: true,
			revision: { number: 2 },
			publishRefused: {
				allowed: false,
				code: 'version-conflict',
				reason:
					'Version 2 was published by someone else at the same time; publish again to make the next one'
			}
		});
		expect(alices).not.toHaveProperty('published');
	});

	it('rejects editing a draft that does not exist', async () => {
		expect(await editDraft(context({ mode: 'governed' }), [uncollect], alice, at)).toMatchObject({
			ok: false,
			code: 'unknown-revision'
		});
	});

	it('detects a concurrent write through gap-free numbering', async () => {
		const draft = context({ mode: 'governed' });
		const created = await createDraft(draft, incidentManagement, alice, at);
		await editDraft(draft, [uncollect], alice, at);
		const stale = created.ok ? { ...created.revision, number: 2 } : undefined;
		await expect(draft.store.appendRevision('def-incident', stale as never)).rejects.toBeInstanceOf(
			NumberingConflictError
		);
		await expect(createDraft(draft, incidentManagement, alice, at)).rejects.toThrow(
			'def-incident: expected revision 3 next, but got revision 1'
		);
	});

	it('stores frozen copies', async () => {
		const draft = context({ mode: 'governed' });
		await createDraft(draft, incidentManagement, alice, at);
		const head = await draft.store.head('def-incident');
		expect(Object.isFrozen(head?.document)).toBe(true);
		expect(head?.document).not.toBe(incidentManagement);
	});
});
