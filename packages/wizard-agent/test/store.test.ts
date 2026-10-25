import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { readWorkbook } from '@casebook/sheet-import';
import type { Operation } from '@casebook/model';
import {
	createDb,
	createWizardSession,
	DEMO_ISSUER,
	listDefinitions,
	loadWizardSession,
	saveWizardSession,
	schema,
	seedDemo,
	type Db
} from '@casebook/store';
import {
	pendingTurn,
	sampleWorkbook,
	SAMPLE_FILE_NAME,
	startState,
	storeDrafts,
	wizard,
	type WizardState
} from '../src/index.js';
import { answer, call, ScriptedModel } from './fake-model.js';

const url = inject('testDatabaseUrl');
const workbook = readWorkbook(sampleWorkbook());
const src = (ref: string) => ({ doc: SAMPLE_FILE_NAME, ref, inferred: false });

const draftOps: Operation[] = [
	{
		op: 'add_node',
		node: {
			core: {
				id: 'stage.registration',
				kind: 'stage',
				title: 'Registration',
				source: src("'Birth reg'!A6")
			}
		}
	},
	{
		op: 'add_node',
		node: {
			core: {
				id: 'role.parent',
				kind: 'role',
				title: 'Parent',
				scope: 'case',
				source: src("'Birth reg'!B6")
			}
		}
	},
	{
		op: 'add_node',
		node: {
			core: {
				id: 'fact.birth-certificate',
				kind: 'fact',
				title: 'Birth certificate',
				schema: { type: 'string' },
				source: src("'Birth reg'!E6")
			}
		}
	},
	{
		op: 'add_node',
		node: {
			core: {
				id: 'step.register-the-birth',
				kind: 'step',
				title: 'Register the birth',
				stage: 'stage.registration',
				role: 'role.parent',
				actor: 'human',
				collects: [{ fact: 'fact.birth-certificate' }],
				source: src("'Birth reg'!A6:F6")
			}
		}
	}
];

describe.skipIf(!url)('the wizard on the store (Postgres)', () => {
	let db: Db;
	const users: Record<string, { id: string }> = {};
	let engId: string;

	beforeAll(async () => {
		db = createDb(url!);
		await seedDemo(db);
		const rows = await db
			.select({ id: schema.principals.id, subject: schema.principals.subject })
			.from(schema.principals)
			.where(eq(schema.principals.issuer, DEMO_ISSUER));
		for (const row of rows) users[row.subject] = { id: row.id };
		const namespaces = await listDefinitions(db, users.wren!);
		engId = namespaces.find((n) => n.namespace.path === 'acme/eng')!.namespace.id;
	});
	afterAll(async () => {
		await db?.$client.end();
	});

	async function split(): Promise<WizardState> {
		const model = new ScriptedModel([
			call('propose_split', {
				processes: [
					{
						title: 'Wizard birth registration',
						summary: 'Register the birth',
						sources: [{ sheet: 'Birth reg', range: 'A2:G7' }]
					}
				]
			}),
			answer('One process.')
		]);
		return wizard.proposeSplit(
			{ model, drafts: storeDrafts(db, users.wren!), workbook },
			startState(SAMPLE_FILE_NAME)
		);
	}

	it('creates, proposes and saves as the signed-in person, one revision per accepted turn', async () => {
		const drafts = storeDrafts(db, users.wren!);
		let state = await wizard.acceptSplit(drafts, await split(), engId);
		const [process] = state.processes;
		const model = new ScriptedModel([
			call('apply_operations', { operations: draftOps }),
			answer('Drafted.')
		]);
		state = await wizard.draft({ model, drafts, workbook }, state, process!.key);

		const before = await drafts.head(process!.definitionId);
		expect(before.ok && before.revision).toBe(1);
		state = await wizard.acceptTurn(drafts, state, pendingTurn(state, process!.key)!.id, 1);

		const revisions = await db
			.select()
			.from(schema.draftRevisions)
			.where(eq(schema.draftRevisions.definitionId, process!.definitionId))
			.orderBy(schema.draftRevisions.revision);
		expect(revisions.map((r) => [r.revision, r.authorId])).toEqual([
			[1, users.wren!.id],
			[2, users.wren!.id]
		]);
		expect(revisions[1]!.ops).toEqual(draftOps);
		const process0 = (revisions[0]!.body as { nodes: { core: { source?: unknown } }[] }).nodes[0];
		expect(process0!.core.source).toEqual({
			doc: SAMPLE_FILE_NAME,
			ref: "'Birth reg'!A2:G7",
			inferred: false
		});
		expect(state.processes[0]!.drafted).toBe(true);
	});

	it('refuses what the signed-in person cannot do', async () => {
		const reader = storeDrafts(db, users.rae!);
		await expect(wizard.acceptSplit(reader, await split(), engId)).rejects.toThrow(
			/"Rae Reader" cannot create definitions in namespace acme\/eng/
		);

		// A process Wren created: Rae can read it but not preview or save an edit.
		const state = await wizard.acceptSplit(storeDrafts(db, users.wren!), await split(), engId);
		const { definitionId } = state.processes[0]!;
		expect((await reader.head(definitionId)).ok).toBe(true);
		const preview = await reader.preview(definitionId, 1, draftOps);
		expect(preview).toMatchObject({
			ok: false,
			reason: expect.stringMatching(/cannot edit the draft/)
		});
	});

	it('keeps an import’s session for the person who started it only', async () => {
		const started = await createWizardSession(db, users.wren!, {
			namespaceId: engId,
			fileName: SAMPLE_FILE_NAME,
			workbook,
			state: startState(SAMPLE_FILE_NAME)
		});
		if (!started.ok) throw new Error(started.reason);
		const { id } = started.session;

		expect(await loadWizardSession(db, users.olive!, id)).toMatchObject({
			ok: false,
			code: 'not-found'
		});
		const saved = await saveWizardSession(db, users.wren!, {
			id,
			baseVersion: 1,
			state: { changed: true }
		});
		expect(saved).toEqual({ ok: true, version: 2 });
		expect(
			await saveWizardSession(db, users.wren!, { id, baseVersion: 1, state: {} })
		).toMatchObject({
			ok: false,
			code: 'stale-draft'
		});
		const loaded = await loadWizardSession(db, users.wren!, id);
		expect(loaded.ok && loaded.session.state).toEqual({ changed: true });

		expect(
			await createWizardSession(db, users.rae!, {
				namespaceId: engId,
				fileName: 'x.xlsx',
				workbook: {},
				state: {}
			})
		).toMatchObject({ ok: false, code: 'access-denied' });
	});
});
