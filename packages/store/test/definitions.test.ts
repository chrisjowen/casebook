import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Operation } from '@casebook/model';
import { createDb, type Db } from '../src/client.js';
import {
	contentHash,
	createDefinition,
	editDefinition,
	listDefinitions,
	loadDefinition,
	publishDefinition,
	undoDefinitionEdit,
	type DefinitionForActor,
	type Refusal
} from '../src/definitions.js';
import { findUser, listUsers } from '../src/people.js';
import { createPrincipal } from '../src/repository.js';
import { DEMO_ISSUER, seedDemo } from '../src/seed.js';
import { definitionVersions, draftRevisions, principals } from '../src/schema.js';

describe('contentHash', () => {
	it('ignores object key order', () => {
		expect(contentHash({ a: 1, b: [{ c: 2, d: 3 }] })).toBe(
			contentHash({ b: [{ d: 3, c: 2 }], a: 1 })
		);
		expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: 2 }));
	});
});

const url = inject('testDatabaseUrl');

describe.skipIf(!url)('definition editing (Postgres)', () => {
	let db: Db;
	const users: Record<'olive' | 'devon' | 'wren' | 'rae', { id: string }> = {} as never;

	beforeAll(async () => {
		db = createDb(url!);
		const { seeded } = await seedDemo(db);
		expect(seeded).toBe(true);
		const rows = await db
			.select({ id: principals.id, subject: principals.subject })
			.from(principals)
			.where(eq(principals.issuer, DEMO_ISSUER));
		for (const row of rows) users[row.subject as keyof typeof users] = { id: row.id };
	});
	afterAll(async () => {
		await db?.$client.end();
	});

	async function definition(actor: { id: string }, slug: string): Promise<DefinitionForActor> {
		const found = (await listDefinitions(db, actor))
			.flatMap((n) => n.definitions)
			.find((d) => d.slug === slug);
		if (!found) throw new Error(`${slug} is not visible`);
		return found;
	}

	function expectRefusal(result: { ok: boolean }, code: Refusal['code'], reason?: RegExp) {
		expect(result.ok).toBe(false);
		expect((result as Refusal).code).toBe(code);
		if (reason) expect((result as Refusal).reason).toMatch(reason);
	}

	const rename = (id: string, title: string): Operation => ({
		op: 'update_core',
		id: id as `step.${string}`,
		changes: { title }
	});

	it('seeds once: a second run writes nothing', async () => {
		expect((await seedDemo(db)).seeded).toBe(false);
	});

	it('lists the demo users with their roles, for the dev sign-in', async () => {
		expect(await listUsers(db, DEMO_ISSUER)).toEqual([
			{
				id: users.devon.id,
				displayName: 'Devon Developer',
				roles: ['developer of acme', 'namespace-admin on acme/eng/platform']
			},
			{ id: users.olive.id, displayName: 'Olive Owner', roles: ['account-owner of acme'] },
			{ id: users.rae.id, displayName: 'Rae Reader', roles: ['read-only of acme'] },
			{
				id: users.wren.id,
				displayName: 'Wren Writer',
				roles: ['read-only of acme', 'write on acme/eng']
			}
		]);
		expect(await findUser(db, DEMO_ISSUER, users.rae.id)).toMatchObject({
			displayName: 'Rae Reader'
		});
		expect(await findUser(db, 'another-issuer', users.rae.id)).toBeUndefined();
		expect(await findUser(db, DEMO_ISSUER, 'not-a-uuid')).toBeUndefined();
	});

	it('lists each seeded definition with its draft, published version and checks', async () => {
		const workspaces = await listDefinitions(db, users.olive);
		expect(workspaces.map((w) => w.namespace.path)).toEqual([
			'acme',
			'acme/eng',
			'acme/eng/platform',
			'acme/eng/sre',
			'personal',
			'personal/example-user',
			'personal/example-user/family'
		]);
		const incident = await definition(users.olive, 'incident-management');
		expect(incident.changePolicy).toBe('governed');
		expect(incident.published?.version).toBe(1);
		expect(incident.draft?.number).toBe(1);
		expect(incident.changes).toEqual([]);
		expect(incident.check.ok).toBe(true);
		expect(incident.can.edit.allowed).toBe(true);
		const birth = await definition(users.olive, 'birth-registration-abroad');
		expect(birth.changePolicy).toBe('living');
		expect(birth.published?.version).toBe(1);
	});

	it('hides namespaces the actor cannot read, and explains what they cannot do', async () => {
		const wren = await listDefinitions(db, users.wren);
		const sre = wren.find((w) => w.namespace.path === 'acme/eng/sre')!;
		expect(sre.can.create.allowed).toBe(true);
		expect(sre.definitions[0]!.can.edit.allowed).toBe(true);
		const family = wren.find((w) => w.namespace.path === 'personal/example-user/family')!;
		expect(family.can.create.allowed).toBe(false);
		expect(family.definitions[0]!.can.edit.reason).toMatch(/Wren Writer.*cannot edit/);

		const outsider = await createPrincipal(db, {
			kind: 'user',
			displayName: 'Outsider',
			issuer: 'casebook-test',
			subject: 'outsider'
		});
		expect(await listDefinitions(db, outsider)).toEqual([]);

		const rae = await definition(users.rae, 'incident-management');
		expect(rae.can.edit).toMatchObject({
			allowed: false,
			reason: expect.stringMatching(/read-only/)
		});
		expect(rae.can.publish.allowed).toBe(false);
	});

	it('refuses edits, undo, publish and create by a read-only user, writing nothing', async () => {
		const incident = await definition(users.rae, 'incident-management');
		const before = await db.select().from(draftRevisions);
		expectRefusal(
			await editDefinition(db, users.rae, {
				definitionId: incident.id,
				ops: [rename('step.classify-severity', 'Triage')],
				baseRevision: 1
			}),
			'access-denied',
			/Rae Reader.*cannot edit the draft of/
		);
		expectRefusal(
			await undoDefinitionEdit(db, users.rae, { definitionId: incident.id, baseRevision: 1 }),
			'access-denied'
		);
		expectRefusal(
			await publishDefinition(db, users.rae, { definitionId: incident.id, baseRevision: 1 }),
			'access-denied',
			/cannot publish/
		);
		expectRefusal(
			await createDefinition(db, users.rae, {
				namespaceId: incident.namespace.id,
				title: 'Not allowed'
			}),
			'access-denied',
			/cannot create definitions in/
		);
		expect(await db.select().from(draftRevisions)).toHaveLength(before.length);
	});

	it('saves edits as draft revisions, diffs them against the published version, and undoes', async () => {
		const start = await definition(users.wren, 'incident-management');
		const step = start.draft!.document.nodes.find((n) => n.core.kind === 'step')!;
		const edited = await editDefinition(db, users.wren, {
			definitionId: start.id,
			ops: [rename(step.core.id, 'Triage the incident')],
			baseRevision: start.draft!.number
		});
		expect(edited).toMatchObject({ ok: true, revision: start.draft!.number + 1 });

		const after = (await loadDefinition(db, start.id))!;
		expect(after.published?.version).toBe(1);
		expect(
			after.published?.document.nodes.find((n) => n.core.id === step.core.id)?.core.title
		).toBe(step.core.title);
		expect(after.draft?.document.version).toBe(2);
		expect(after.changes.map((c) => c.summary)).toEqual([
			`Renamed step ${step.core.title} to Triage the incident`
		]);
		expect(after.draft?.authorName).toBe('Wren Writer');

		// A stale base revision is refused rather than overwriting the newer draft.
		expectRefusal(
			await editDefinition(db, users.wren, {
				definitionId: start.id,
				ops: [rename(step.core.id, 'Lost update')],
				baseRevision: start.draft!.number
			}),
			'stale-draft'
		);

		const undone = await undoDefinitionEdit(db, users.wren, {
			definitionId: start.id,
			baseRevision: after.draft!.number
		});
		expect(undone).toMatchObject({ ok: true, revision: after.draft!.number + 1 });
		const restored = (await loadDefinition(db, start.id))!;
		expect(restored.changes).toEqual([]);
		expect(restored.draft?.undoable).toBe(false);
	});

	it('rejects an operation the model refuses, with its reason', async () => {
		const incident = await definition(users.olive, 'incident-management');
		const fact = incident.draft!.document.nodes.find((n) => n.core.kind === 'fact')!;
		expectRefusal(
			await editDefinition(db, users.olive, {
				definitionId: incident.id,
				ops: [{ op: 'remove_node', id: fact.core.id }],
				baseRevision: incident.draft!.number
			}),
			'referenced',
			/refer/
		);
		expectRefusal(
			await editDefinition(db, users.olive, {
				definitionId: incident.id,
				ops: [{ op: 'explode' }],
				baseRevision: incident.draft!.number
			}),
			'invalid-operation'
		);
	});

	it('saves a stage reorder as a draft change, which undo takes back', async () => {
		const start = await definition(users.wren, 'incident-management');
		const moved = await editDefinition(db, users.wren, {
			definitionId: start.id,
			ops: [{ op: 'move_stage', id: 'stage.review', before: 'stage.respond' }],
			baseRevision: start.draft!.number
		});
		expect(moved).toMatchObject({ ok: true, revision: start.draft!.number + 1 });
		const after = (await loadDefinition(db, start.id))!;
		expect(after.changes.map((c) => c.summary)).toEqual([
			'Reordered stages: Detect, Review, Respond, Resolve'
		]);
		const undone = await undoDefinitionEdit(db, users.wren, {
			definitionId: start.id,
			baseRevision: after.draft!.number
		});
		expect(undone.ok).toBe(true);
		expect((await loadDefinition(db, start.id))!.changes).toEqual([]);
	});

	it('publishes a governed draft through the publish checks', async () => {
		const start = await definition(users.wren, 'incident-management');
		expectRefusal(
			await publishDefinition(db, users.wren, {
				definitionId: start.id,
				baseRevision: start.draft!.number
			}),
			'no-change',
			/Nothing has changed since version 1/
		);

		// A step requiring a fact nothing collects fails the publish checks.
		const ops: Operation[] = [
			{
				op: 'add_node',
				node: {
					core: { id: 'fact.orphan', kind: 'fact', title: 'Orphan', schema: { type: 'string' } }
				}
			},
			{ op: 'link', from: 'step.write-rca', edge: 'requires', to: 'fact.orphan' }
		];
		const broken = await editDefinition(db, users.wren, {
			definitionId: start.id,
			ops,
			baseRevision: start.draft!.number
		});
		expect(broken.ok).toBe(true);
		const failing = await publishDefinition(db, users.wren, {
			definitionId: start.id,
			baseRevision: (broken as { revision: number }).revision
		});
		expectRefusal(failing, 'checks-failed', /Fix these before publishing/);
		expect((failing as Refusal).issues.length).toBeGreaterThan(0);

		const fixed = await undoDefinitionEdit(db, users.wren, {
			definitionId: start.id,
			baseRevision: (broken as { revision: number }).revision
		});
		expect(fixed.ok).toBe(true);
		const renamed = await editDefinition(db, users.wren, {
			definitionId: start.id,
			ops: [rename('step.write-rca', 'Write the RCA')],
			baseRevision: (fixed as { revision: number }).revision
		});
		expect(renamed.ok).toBe(true);

		const reviewed = (renamed as { revision: number }).revision;
		const moved = await editDefinition(db, users.olive, {
			definitionId: start.id,
			ops: [rename('step.write-rca', 'Write up the incident')],
			baseRevision: reviewed
		});
		expect(moved.ok).toBe(true);
		expectRefusal(
			await publishDefinition(db, users.wren, { definitionId: start.id, baseRevision: reviewed }),
			'stale-draft'
		);
		const head = (moved as { revision: number }).revision;
		const publishers = [users.wren, users.olive];
		const results = await Promise.all(
			publishers.map((actor) =>
				publishDefinition(db, actor, { definitionId: start.id, baseRevision: head })
			)
		);
		const winner = results.findIndex((r) => r.ok);
		expect(results.filter((r) => r.ok)).toHaveLength(1);
		expect(results[winner]).toMatchObject({ ok: true, version: 2 });
		expectRefusal(results[1 - winner]!, 'no-change');
		const after = (await loadDefinition(db, start.id))!;
		expect(after.published?.version).toBe(2);
		expect(after.published?.publishedByName).toBe(['Wren Writer', 'Olive Owner'][winner]);
		expect(after.changes).toEqual([]);
		const [version] = await db
			.select()
			.from(definitionVersions)
			.where(and(eq(definitionVersions.definitionId, start.id), eq(definitionVersions.version, 2)));
		expect(version?.contentHash).toBe(contentHash(version?.body));
	});

	it('publishes every edit of a living definition, and refuses an explicit publish', async () => {
		const birth = await definition(users.olive, 'birth-registration-abroad');
		const step = birth.draft!.document.nodes.find((n) => n.core.kind === 'step')!;
		const edited = await editDefinition(db, users.olive, {
			definitionId: birth.id,
			ops: [rename(step.core.id, 'Renamed live')],
			baseRevision: birth.draft!.number
		});
		expect(edited).toMatchObject({ ok: true, version: 2 });
		const after = (await loadDefinition(db, birth.id))!;
		expect(after.published?.version).toBe(2);
		expect(after.changes).toEqual([]);
		expectRefusal(
			await publishDefinition(db, users.olive, {
				definitionId: birth.id,
				baseRevision: (edited as { revision: number }).revision
			}),
			'no-change',
			/living/
		);
	});

	it('creates a process with a starter draft where the actor may write', async () => {
		const devon = await listDefinitions(db, users.devon);
		const platform = devon.find((w) => w.namespace.path === 'acme/eng/platform')!;
		const sre = devon.find((w) => w.namespace.path === 'acme/eng/sre')!;
		expect(platform.can.create.allowed).toBe(true);
		expect(sre.can.create.allowed).toBe(false);

		const created = await createDefinition(db, users.devon, {
			namespaceId: platform.namespace.id,
			title: 'Deploy a service'
		});
		expect(created).toMatchObject({ ok: true, slug: 'deploy-a-service' });
		const again = await createDefinition(db, users.devon, {
			namespaceId: platform.namespace.id,
			title: 'Deploy a service'
		});
		expect(again).toMatchObject({ ok: true, slug: 'deploy-a-service-2' });

		const state = await definition(users.devon, 'deploy-a-service');
		expect(state.published).toBeUndefined();
		expect(state.draft?.number).toBe(1);
		expect(state.draft?.document.namespace).toBe('acme/eng/platform');
		expect(state.check.ok).toBe(true);
		expect(state.can.publish.allowed).toBe(true);
		expect(
			await publishDefinition(db, users.devon, {
				definitionId: state.id,
				baseRevision: state.draft!.number
			})
		).toMatchObject({ ok: true, version: 1 });

		const living = await createDefinition(db, users.devon, {
			namespaceId: platform.namespace.id,
			title: 'On-call handover',
			changePolicy: 'living'
		});
		expect(living).toMatchObject({ ok: true, version: 1 });
		expectRefusal(
			await createDefinition(db, users.devon, { namespaceId: sre.namespace.id, title: 'No' }),
			'access-denied',
			/Devon Developer" cannot create definitions in namespace acme\/eng\/sre/
		);
	});
});
