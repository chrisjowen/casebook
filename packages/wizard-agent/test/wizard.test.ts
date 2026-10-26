import { describe, expect, it } from 'vitest';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { readWorkbook } from '@casebook/sheet-import';
import type { Operation } from '@casebook/model';
import {
	history,
	leadingObject,
	memoryDrafts,
	type LiveTurn,
	mergeProcesses,
	pendingTurn,
	renameProcess,
	sampleWorkbook,
	SAMPLE_FILE_NAME,
	splitProcess,
	startState,
	wizard,
	WizardError,
	type AgentContext,
	type WizardState
} from '../src/index.js';
import {
	answer,
	call,
	lastToolResult,
	ScriptedModel,
	StreamingScriptedModel,
	type Step
} from './fake-model.js';

const workbook = readWorkbook(sampleWorkbook());
const FILE = SAMPLE_FILE_NAME;

function context(script: Step[], drafts = memoryDrafts(), { lenient = false } = {}) {
	const model = new ScriptedModel(script);
	const ctx: AgentContext = { model, drafts, workbook, lenient };
	return { ctx, model, drafts };
}

const birth = {
	title: 'Birth registration',
	summary: 'Register the birth',
	sources: [{ sheet: 'Birth reg', range: 'A2:G7' }]
};
const passport = {
	title: 'Child passport and ID',
	summary: 'ID card and passport',
	sources: [{ sheet: 'Passport & ID', range: 'A2:F4' }]
};
const claims = {
	title: 'Medical claims',
	summary: 'Claim medical bills',
	sources: [{ sheet: 'Claims', range: 'A2:F8' }]
};
const documents = {
	title: 'Shared document set',
	summary: 'Documents several processes ask for',
	sources: [{ sheet: 'Documents', range: 'A2:D6' }]
};

/** Runs the split phase with a scripted agent and accepts the split into memory drafts. */
async function acceptedSplit() {
	const { ctx, drafts } = context([
		call('propose_split', { processes: [birth, passport, claims], shared: [documents] }),
		answer('Three processes, plus the documents sheet as shared cells.')
	]);
	let state = await wizard.proposeSplit(ctx, startState(FILE));
	state = await wizard.acceptSplit(drafts, state, 'ns-1');
	return { state, drafts };
}

const src = (ref: string, inferred = false) => ({ doc: FILE, ref, inferred });

/** The first draft of Birth registration an agent might propose, in node operations. */
const firstDraft: Operation[] = [
	{
		op: 'add_node',
		node: {
			core: {
				id: 'stage.before-the-birth',
				kind: 'stage',
				title: 'Before the birth',
				source: src("'Birth reg'!C3")
			}
		}
	},
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
				source: src("'Birth reg'!B3")
			}
		}
	},
	{
		op: 'add_node',
		node: {
			core: {
				id: 'fact.home-address',
				kind: 'fact',
				title: 'Home address',
				schema: { type: 'string' },
				source: src("'Birth reg'!E3")
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
				schema: { type: 'string', 'x-evidence': { description: 'Birth certificate' } },
				source: src("'Birth reg'!E6")
			}
		}
	},
	{
		op: 'add_node',
		node: {
			core: {
				id: 'step.gather-documents',
				kind: 'step',
				title: 'Gather the family document set',
				stage: 'stage.before-the-birth',
				role: 'role.parent',
				actor: 'human',
				collects: [{ fact: 'fact.home-address' }],
				source: src("'Birth reg'!A3:F3")
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
				requires: ['fact.home-address'],
				collects: [{ fact: 'fact.birth-certificate' }],
				source: src("'Birth reg'!A6:F6")
			}
		}
	}
];

describe('choosing the processes', () => {
	it('records the agent’s split and its reply, after the agent fixes a refused proposal', async () => {
		const { ctx, model } = context([
			call('read_cells', { ranges: [{ sheet: 'Birth reg', range: 'A1:G7' }] }),
			(messages) => {
				expect(lastToolResult(messages)).toContain('Gather the family document set');
				return call('propose_split', {
					processes: [{ ...birth, sources: [{ sheet: 'Birth registration', range: 'A2:G7' }] }]
				})(messages);
			},
			(messages) => {
				expect(lastToolResult(messages)).toMatch(
					/Not recorded.*there is no sheet "Birth registration"/s
				);
				return call('propose_split', { processes: [birth, passport, claims], shared: [documents] })(
					messages
				);
			},
			answer('I suggest three processes. The documents sheet is shared.')
		]);
		const state = await wizard.proposeSplit(ctx, startState(FILE));
		expect(model.remaining).toBe(0);
		expect(state.phase).toBe('split');
		expect(state.split?.processes.map((p) => p.title)).toEqual([
			'Birth registration',
			'Child passport and ID',
			'Medical claims'
		]);
		expect(state.split?.shared).toEqual([documents]);
		expect(state.messages.at(-1)).toMatchObject({
			role: 'assistant',
			text: 'I suggest three processes. The documents sheet is shared.',
			card: { type: 'split' }
		});
	});

	it('renames, merges and splits proposed processes, then creates only the live ones', async () => {
		const { ctx, drafts } = context([
			call('propose_split', { processes: [birth, passport, claims], shared: [documents] }),
			answer('Three processes.')
		]);
		let state = await wizard.proposeSplit(ctx, startState(FILE));
		const [b, p, c] = state.split!.processes;
		state = mergeProcesses(state, p!.key, b!.key);
		state = renameProcess(state, c!.key, 'Medical bill claims');
		expect(state.split!.processes.find((x) => x.key === c!.key)).toMatchObject({
			title: 'Medical bill claims',
			suggestedTitle: 'Medical claims'
		});
		const merged = state.split!.processes.find((x) => x.key === b!.key)!;
		expect(merged.sources).toEqual([...birth.sources, ...passport.sources]);
		expect(state.split!.processes.find((x) => x.key === p!.key)?.mergedInto).toBe(b!.key);
		expect(() => renameProcess(state, p!.key, 'Gone')).toThrow(WizardError);

		// Splitting the merged process back apart, by the range that came from the merge.
		const resplit = splitProcess(state, b!.key, 1, 'Passport and ID');
		expect(resplit.split!.processes.filter((x) => !x.mergedInto).map((x) => x.title)).toEqual([
			'Birth registration',
			'Passport and ID',
			'Medical bill claims'
		]);
		expect(() => splitProcess(state, c!.key, 0)).toThrow(/one range of cells/);

		state = await wizard.acceptSplit(drafts, state, 'ns-1');
		expect(state.phase).toBe('draft');
		expect(state.processes.map((x) => [x.title, x.slug])).toEqual([
			['Birth registration', 'birth-registration'],
			['Medical bill claims', 'medical-bill-claims']
		]);
		expect(state.activeKey).toBe(b!.key);
		const head = await drafts.head('birth-registration');
		expect(head.ok && head.document.nodes).toEqual([
			{
				core: {
					id: 'process.birth-registration',
					kind: 'process',
					title: 'Birth registration',
					source: { doc: FILE, ref: "'Birth reg'!A2:G7, 'Passport & ID'!A2:F4", inferred: false }
				}
			}
		]);
		expect(state.messages.filter((m) => m.role === 'note').map((m) => m.text)).toEqual([
			'Merged "Child passport and ID" into "Birth registration".',
			'Renamed "Medical claims" to "Medical bill claims".',
			'Split accepted: 2 processes.'
		]);
	});

	it('lets the agent revise the split from a reply in chat', async () => {
		const { ctx, model } = context([
			call('propose_split', { processes: [birth, passport] }),
			answer('Two processes.'),
			call('propose_split', {
				processes: [{ ...birth, sources: [...birth.sources, ...passport.sources] }]
			}),
			answer('Merged them into one.')
		]);
		let state = await wizard.proposeSplit(ctx, startState(FILE));
		state = await wizard.reply(ctx, state, 'The passport is part of registering the birth.');
		const seen = model.sent
			.at(-1)!
			.map((m) => String(m.content))
			.join('\n');
		expect(seen.split('The passport is part of registering the birth.')).toHaveLength(2);
		expect(state.split!.processes.map((p) => p.title)).toEqual(['Birth registration']);
		expect(state.messages.map((m) => m.role)).toEqual([
			'assistant',
			'assistant',
			'user',
			'assistant'
		]);
	});
});

describe('drafting a process', () => {
	it('collects a turn’s operations as one pending proposal, saving nothing', async () => {
		const accepted = await acceptedSplit();
		const { ctx, model } = context(
			[
				call('read_draft', {}),
				(messages) => {
					expect(JSON.parse(lastToolResult(messages))).toMatchObject({
						process: 'Birth registration',
						nodes: [{ core: { id: 'process.birth-registration' } }]
					});
					// No source on a new node: refused, and nothing is applied.
					const core = { ...(firstDraft[0] as Extract<Operation, { op: 'add_node' }>).node.core };
					delete core.source;
					return call('apply_operations', { operations: [{ op: 'add_node', node: { core } }] })(
						messages
					);
				},
				(messages) => {
					expect(lastToolResult(messages)).toMatch(/Nothing applied\..*has no core\.source/s);
					// A reference to a stage that does not exist is refused by the model's checks.
					return call('apply_operations', { operations: [firstDraft[5]] })(messages);
				},
				(messages) => {
					expect(lastToolResult(messages)).toMatch(/Nothing applied\..*stage\.before-the-birth/s);
					return call('apply_operations', { operations: firstDraft.slice(0, 4) })(messages);
				},
				(messages) => {
					expect(lastToolResult(messages)).toMatch(
						/Applied 4 of 4 operations; your proposal now has 4/
					);
					return call('apply_operations', { operations: firstDraft.slice(4) })(messages);
				},
				(messages) => {
					expect(lastToolResult(messages)).toMatch(
						/proposal now has 7.*Nothing blocks publishing/s
					);
					return answer('Here is a first draft: 2 steps in 2 stages.')(messages);
				}
			],
			accepted.drafts
		);
		const state = await wizard.draft(ctx, accepted.state, accepted.state.activeKey!);
		expect(model.remaining).toBe(0);
		const turn = pendingTurn(state, state.activeKey!);
		expect(turn).toMatchObject({
			ops: firstDraft,
			summary: 'Here is a first draft: 2 steps in 2 stages.'
		});
		expect(state.messages.at(-1)).toMatchObject({
			role: 'assistant',
			card: { type: 'turn', turnId: turn!.id }
		});
		const head = await accepted.drafts.head('birth-registration');
		expect(head.ok && head.revision).toBe(1);
	});

	it('saves an accepted turn as one edit, with every node linked to its cells', async () => {
		const { state: split, drafts } = await acceptedSplit();
		const { ctx } = context(
			[call('apply_operations', { operations: firstDraft }), answer('Drafted.')],
			drafts
		);
		let state = await wizard.draft(ctx, split, split.activeKey!);
		const turn = pendingTurn(state, state.activeKey!)!;
		state = await wizard.acceptTurn(drafts, state, turn.id, 1);

		const revisions = drafts.drafts.get('birth-registration')!;
		expect(revisions).toHaveLength(2);
		expect(revisions[1]!.ops).toEqual(firstDraft);
		for (const node of revisions[1]!.document.nodes) {
			expect(node.core.source?.doc, node.core.id).toBe(FILE);
		}
		expect(state.turns[0]).toMatchObject({ status: 'accepted' });
		expect(state.turns[0]!.changes).toContain('Added step Register the birth');
		expect(state.processes[0]!.drafted).toBe(true);
		expect(state.messages.at(-1)?.text).toBe(
			'Accepted the changes to Birth registration. They are saved to its draft.'
		);
		await expect(wizard.acceptTurn(drafts, state, turn.id, 2)).rejects.toThrow(/no longer waiting/);
	});

	it('drops a rejected turn without saving anything', async () => {
		const { state: split, drafts } = await acceptedSplit();
		const { ctx } = context(
			[call('apply_operations', { operations: firstDraft }), answer('Drafted.')],
			drafts
		);
		let state = await wizard.draft(ctx, split, split.activeKey!);
		state = wizard.rejectTurn(state, pendingTurn(state, state.activeKey!)!.id);
		expect(state.turns[0]!.status).toBe('rejected');
		expect(drafts.drafts.get('birth-registration')).toHaveLength(1);
		expect(state.messages.at(-1)?.text).toBe(
			'Rejected the proposed changes to Birth registration. Nothing was saved.'
		);
	});

	it('refuses to accept a turn against a draft that changed since it was reviewed', async () => {
		const { state: split, drafts } = await acceptedSplit();
		const { ctx } = context(
			[call('apply_operations', { operations: firstDraft }), answer('Drafted.')],
			drafts
		);
		const state = await wizard.draft(ctx, split, split.activeKey!);
		await drafts.edit('birth-registration', 1, [
			{ op: 'set_content', id: 'process.birth-registration', content: 'Edited by hand' }
		]);
		await expect(
			wizard.acceptTurn(drafts, state, pendingTurn(state, state.activeKey!)!.id, 1)
		).rejects.toThrow(/The draft changed while you were editing/);
	});

	it('revises the pending proposal when the person pushes back in chat', async () => {
		const { state: split, drafts } = await acceptedSplit();
		const hospitalStep: Operation[] = [
			{
				op: 'add_node',
				node: {
					core: {
						id: 'role.hospital',
						kind: 'role',
						title: 'Hospital',
						scope: 'namespace',
						source: src("'Birth reg'!B4")
					}
				}
			},
			{
				op: 'add_node',
				node: {
					core: {
						id: 'stage.at-the-hospital',
						kind: 'stage',
						title: 'At the hospital',
						source: src("'Birth reg'!C4", true)
					}
				}
			},
			{ op: 'move_stage', id: 'stage.at-the-hospital', before: 'stage.registration' },
			{
				op: 'add_node',
				node: {
					core: {
						id: 'fact.date-of-birth',
						kind: 'fact',
						title: 'Date and time of birth',
						schema: { type: 'string', format: 'date-time' },
						source: src("'Birth reg'!E4")
					}
				}
			},
			{
				op: 'add_node',
				node: {
					core: {
						id: 'step.record-birth-details',
						kind: 'step',
						title: 'Record the birth details',
						stage: 'stage.at-the-hospital',
						role: 'role.hospital',
						actor: 'human',
						collects: [{ fact: 'fact.date-of-birth' }],
						source: src("'Birth reg'!A4:F4")
					}
				}
			}
		];
		const { ctx, model } = context(
			[
				call('apply_operations', { operations: firstDraft }),
				answer('First draft.'),
				call('read_draft', {}),
				(messages) => {
					expect(JSON.parse(lastToolResult(messages)).yourOperationsSoFar).toBe(firstDraft.length);
					return call('apply_operations', { operations: hospitalStep })(messages);
				},
				answer('I added a step for the hospital.')
			],
			drafts
		);
		let state = await wizard.draft(ctx, split, split.activeKey!);
		const first = pendingTurn(state, state.activeKey!)!;
		state = await wizard.reply(ctx, state, 'The hospital fills in the birth details, not us.');
		expect(model.remaining).toBe(0);
		const second = pendingTurn(state, state.activeKey!)!;
		expect(second.id).not.toBe(first.id);
		expect(second.ops).toEqual([...firstDraft, ...hospitalStep]);
		expect(state.turns.find((t) => t.id === first.id)?.status).toBe('revised');

		await wizard.acceptTurn(drafts, state, second.id, 1);
		const saved = drafts.drafts.get('birth-registration')!.at(-1)!.document;
		expect(saved.nodes.filter((n) => n.core.kind === 'stage').map((n) => n.core.id)).toEqual([
			'stage.before-the-birth',
			'stage.at-the-hospital',
			'stage.registration'
		]);
	});

	it('records a turn with no operations as a plain reply', async () => {
		const { state: split, drafts } = await acceptedSplit();
		const { ctx } = context(
			[
				answer('Which country is the birth registered in?'),
				answer('Which country is the birth registered in?')
			],
			drafts
		);
		const state = await wizard.reply(ctx, split, 'Draft it.');
		expect(state.turns).toEqual([]);
		expect(state.messages.at(-1)).toEqual(
			expect.objectContaining({
				role: 'assistant',
				text: 'Which country is the birth registered in?'
			})
		);
	});
});

describe('a model that struggles', () => {
	it('is told to stop after repeated refusals, and its reply is kept', async () => {
		const bad = { processes: [{ ...birth, sources: [{ sheet: 'Nope', range: 'A1' }] }] };
		const { ctx } = context([
			call('propose_split', bad),
			(messages) => {
				expect(lastToolResult(messages)).not.toMatch(/same input/);
				return call('propose_split', bad)(messages);
			},
			(messages) => {
				expect(lastToolResult(messages)).toMatch(/same input as your last refused call/);
				return call('propose_split', bad)(messages);
			},
			(messages) => {
				expect(lastToolResult(messages)).toMatch(/3 refusals in a row\. Stop calling tools/);
				return answer('I could not find the sheet.')(messages);
			},
			// Asked once more for the split it did not make, it explains again.
			answer('I still cannot find a sheet to split.')
		]);
		const state = await wizard.proposeSplit(ctx, startState(FILE));
		expect(state.split).toBeUndefined();
		expect(state.messages.at(-1)?.text).toBe('I still cannot find a sheet to split.');
	});

	it('asks once more when a draft or split turn describes a proposal without making it', async () => {
		const { ctx, drafts, model } = context([
			answer('I suggest Birth registration and Medical claims.'),
			(messages) => {
				expect(String(messages.at(-1)!.content)).toMatch(/did not call propose_split/);
				return call('propose_split', { processes: [birth, claims] })(messages);
			},
			answer('Recorded.')
		]);
		let state = await wizard.proposeSplit(ctx, startState(FILE));
		expect(state.split?.processes).toHaveLength(2);
		state = await wizard.acceptSplit(drafts, state, 'ns-1');

		model.script.push(
			answer('Stages: Before the birth, Registration. Steps: ...'),
			(messages) => {
				expect(String(messages.at(-1)!.content)).toMatch(/did not call apply_operations/);
				return call('apply_operations', { operations: firstDraft })(messages);
			},
			answer('Drafted.')
		);
		state = await wizard.draft(ctx, state, state.activeKey!);
		expect(pendingTurn(state, state.activeKey!)?.ops).toEqual(firstDraft);
		expect(state.messages.at(-1)?.text).toBe('Drafted.');

		// A reply in chat may be answered with words alone, once the agent confirms it meant to.
		model.script.push(answer('It has two stages.'), (messages) => {
			expect(String(messages.at(-1)!.content)).toMatch(/if you only answered a question/);
			return answer('Two stages.')(messages);
		});
		state = await wizard.reply(ctx, state, 'How many stages?');
		expect(model.remaining).toBe(0);
		expect(state.messages.at(-1)?.text).toBe('Two stages.');
	});

	it('reads operations written into the reply when the model will not call the tool', async () => {
		const { state: split, drafts } = await acceptedSplit();
		const json = (ops: Operation[]) => '```json\n' + JSON.stringify(ops) + '\n```';
		const { ctx, model } = context(
			[
				answer(`First the stages and roles:\n${json(firstDraft.slice(0, 3))}`),
				(messages) => {
					expect(String(messages.at(-1)!.content)).toMatch(
						/I read the operations from your reply\. Applied 3 of 3 operations/
					);
					const asked = messages
						.map((m) => String(m.content))
						.find((text) => text.includes('The draft now'));
					expect(asked).toContain('The draft now, with your proposal so far applied:');
					expect(asked).toContain('"yourOperationsSoFar":3');
					return answer(`Now the rest:\n${json(firstDraft.slice(3))}`)(messages);
				},
				answer('That is the whole draft.')
			],
			drafts,
			{ lenient: true }
		);
		const state = await wizard.draft(ctx, split, split.activeKey!);
		expect(model.remaining).toBe(0);
		const turn = pendingTurn(state, state.activeKey!)!;
		expect(turn.ops).toEqual(firstDraft);
		expect(turn.summary).toBe('That is the whole draft.');
	});

	it('stops reading replies after a few rounds, keeping what the last one wrote', async () => {
		const { state: split, drafts } = await acceptedSplit();
		const json = (ops: Operation[]) => '```json\n' + JSON.stringify(ops) + '\n```';
		const parts = [
			firstDraft.slice(0, 2),
			firstDraft.slice(2, 4),
			firstDraft.slice(4, 6),
			firstDraft.slice(6)
		];
		const { ctx, model } = context(
			parts.map((ops, i) => answer(`Part ${i + 1}:\n${json(ops)}`)),
			drafts,
			{ lenient: true }
		);
		const state = await wizard.draft(ctx, split, split.activeKey!);
		expect(model.remaining).toBe(0);
		expect(pendingTurn(state, state.activeKey!)?.ops).toEqual(firstDraft);
	});

	it('does not read operations from the reply of a model that is not lenient', async () => {
		const { state: split, drafts } = await acceptedSplit();
		const json = '```json\n' + JSON.stringify(firstDraft) + '\n```';
		const { ctx, model } = context(
			[
				answer(`Here is the draft:\n${json}`),
				(messages) => {
					expect(String(messages.at(-1)!.content)).toMatch(/You did not call apply_operations/);
					return answer(`Here it is again:\n${json}`)(messages);
				}
			],
			drafts
		);
		const state = await wizard.draft(ctx, split, split.activeKey!);
		expect(model.remaining).toBe(0);
		expect(state.turns).toEqual([]);
	});

	it('leaves nodes sent again unchanged alone, and points a changed one at update_core', async () => {
		const { state: split, drafts } = await acceptedSplit();
		const renamed = structuredClone(firstDraft[0]!) as Extract<Operation, { op: 'add_node' }>;
		renamed.node.core.title = 'Before birth';
		const { ctx } = context(
			[
				call('apply_operations', { operations: firstDraft }),
				call('apply_operations', { operations: [...firstDraft.slice(1), renamed] }),
				(messages) => {
					const result = lastToolResult(messages);
					expect(result).toMatch(/Nothing applied\./);
					expect(result).toMatch(/Already in the draft, so left as they are: stage\.registration/);
					expect(result).toMatch(
						/stage\.before-the-birth is already in the draft; leave it out, or change it with update_core/
					);
					return answer('Drafted.')(messages);
				}
			],
			drafts
		);
		const state = await wizard.draft(ctx, split, split.activeKey!);
		expect(pendingTurn(state, state.activeKey!)?.ops).toEqual(firstDraft);
	});

	it('tidies operations written loosely, then checks them as usual', async () => {
		const { state: split, drafts } = await acceptedSplit();
		const loose = firstDraft.map((op) =>
			op.op === 'add_node'
				? {
						...op,
						changes: {},
						node: { core: { ...op.node.core, source: { ref: op.node.core.source!.ref } } }
					}
				: op
		);
		const { ctx } = context(
			[
				call('apply_operations', { operations: loose }),
				(messages) => {
					expect(lastToolResult(messages)).toMatch(/Applied 7 of 7 operations/);
					return answer('Drafted.')(messages);
				}
			],
			drafts,
			{ lenient: true }
		);
		const state = await wizard.draft(ctx, split, split.activeKey!);
		expect(pendingTurn(state, state.activeKey!)?.ops).toEqual(firstDraft);
	});

	it('checks the operations of a model that is not lenient as sent', async () => {
		const { state: split, drafts } = await acceptedSplit();
		const loose = firstDraft.map((op) => ({ ...op, changes: {} }));
		const { ctx } = context(
			[
				call('apply_operations', { operations: loose }),
				(messages) => {
					expect(lastToolResult(messages)).toMatch(/Nothing applied\./);
					return answer('Drafted.')(messages);
				},
				answer('I could not draft it.')
			],
			drafts
		);
		const state = await wizard.draft(ctx, split, split.activeKey!);
		expect(state.turns).toEqual([]);
	});

	it('refuses the sources of a model that is not lenient unless they are complete', async () => {
		const { state: split, drafts } = await acceptedSplit();
		const stage = firstDraft[0] as Extract<Operation, { op: 'add_node' }>;
		const withSourceOf = (source: unknown) => ({
			...stage,
			node: { core: { ...stage.node.core, source } }
		});
		const { ctx } = context(
			[
				call('apply_operations', {
					operations: [
						withSourceOf({ doc: 'other.xlsx', ref: "'Birth reg'!C3", inferred: false }),
						withSourceOf({ doc: FILE, ref: 'C3', inferred: false })
					]
				}),
				(messages) => {
					const result = lastToolResult(messages);
					expect(result).toMatch(/Nothing applied\./);
					expect(result).toMatch(new RegExp(`operation 1 .*core\\.source\\.doc must be "${FILE}"`));
					expect(result).toMatch(/operation 2 .*core\.source\.ref "C3" is not a cell reference/);
					return answer('Drafted.')(messages);
				},
				answer('I could not draft it.')
			],
			drafts
		);
		const state = await wizard.draft(ctx, split, split.activeKey!);
		expect(state.turns).toEqual([]);
	});

	it('completes the bare sources of a lenient model with the upload and its sheet', async () => {
		const { state: split, drafts } = await acceptedSplit();
		const stage = firstDraft[0] as Extract<Operation, { op: 'add_node' }>;
		const { ctx } = context(
			[
				call('apply_operations', {
					operations: [{ ...stage, node: { core: { ...stage.node.core, source: { ref: 'C3' } } } }]
				}),
				(messages) => {
					expect(lastToolResult(messages)).toMatch(/Applied 1 of 1 operations/);
					return answer('Drafted.')(messages);
				}
			],
			drafts,
			{ lenient: true }
		);
		const state = await wizard.draft(ctx, split, split.activeKey!);
		expect(pendingTurn(state, state.activeKey!)?.ops).toEqual([stage]);
	});

	it('refuses a step that does not say who may do it, rather than guessing', async () => {
		const { state: split, drafts } = await acceptedSplit();
		const unsaid = firstDraft.map((op) => {
			if (op.op !== 'add_node' || op.node.core.kind !== 'step') return op;
			const core = Object.entries(op.node.core).filter(([key]) => key !== 'actor');
			return { ...op, node: { core: Object.fromEntries(core) } };
		});
		const { ctx } = context(
			[
				call('apply_operations', { operations: unsaid }),
				(messages) => {
					const result = lastToolResult(messages);
					expect(result).toMatch(/Applied 5 of 7 operations/);
					expect(result).toMatch(/step\.gather-documents: core is missing required field "actor"/);
					expect(result).toMatch(
						/step\.register-the-birth: core is missing required field "actor"/
					);
					return answer('Drafted, without the steps.')(messages);
				}
			],
			drafts,
			{ lenient: true }
		);
		const state = await wizard.draft(ctx, split, split.activeKey!);
		expect(pendingTurn(state, state.activeKey!)?.ops).toEqual(firstDraft.slice(0, 5));
	});

	it('keeps the operations that fit and lists each refused one with its reason', async () => {
		const { state: split, drafts } = await acceptedSplit();
		const broken: Operation = {
			op: 'add_node',
			node: {
				core: {
					id: 'step.orphan',
					kind: 'step',
					title: 'Orphan',
					stage: 'stage.nowhere',
					role: 'role.parent',
					actor: 'human',
					source: src("'Birth reg'!A7")
				}
			}
		};
		const { ctx } = context(
			[
				call('apply_operations', {
					operations: [...firstDraft.slice(0, 5), broken, ...firstDraft.slice(5)]
				}),
				(messages) => {
					const result = lastToolResult(messages);
					expect(result).toMatch(/Applied 7 of 8 operations/);
					expect(result).toMatch(/operation 6 \(add step\.orphan\): .*stage\.nowhere/);
					return answer('Drafted, except one step.')(messages);
				}
			],
			drafts
		);
		const state = await wizard.draft(ctx, split, split.activeKey!);
		expect(pendingTurn(state, state.activeKey!)?.ops).toEqual(firstDraft);
	});

	it('ends a turn that runs out of steps, keeping what it applied for review', async () => {
		const { state: split, drafts } = await acceptedSplit();
		const loop: Step[] = Array.from({ length: 60 }, () => call('read_draft', {}));
		const { ctx } = context(
			[call('apply_operations', { operations: firstDraft }), ...loop],
			drafts
		);
		const state = await wizard.draft(ctx, split, split.activeKey!);
		expect(pendingTurn(state, state.activeKey!)?.ops).toEqual(firstDraft);
		expect(state.messages.at(-1)?.text).toMatch(/ran out of steps/);
	});

	it('only sees the wizard’s tools and instructions, not the harness’s others', async () => {
		const { ctx, model } = context([
			call('write_todos', { todos: [] }),
			answer('Done.'),
			answer('Nothing to split.')
		]);
		await wizard.proposeSplit(ctx, startState(FILE));
		expect(lastToolResult(model.sent[1]!)).toMatch(/write_todos is not available/);
		expect(String(model.sent[0]![0]!.content)).toMatch(/^You help a person turn a spreadsheet/);
	});
});

describe('the conversation the agent sees', () => {
	it('tells it what became of each proposal, as a note from the person', async () => {
		const { state: split, drafts } = await acceptedSplit();
		const { ctx } = context(
			[call('apply_operations', { operations: firstDraft }), answer('Drafted.')],
			drafts
		);
		let state = await wizard.draft(ctx, split, split.activeKey!);
		state = wizard.rejectTurn(state, pendingTurn(state, state.activeKey!)!.id);
		const texts = history(state, 'Try again.').map((m) => String(m.content));
		const drafted = texts.findIndex((t) => t === 'Drafted.');
		expect(texts[drafted + 1]).toMatch(/^\[Your proposal of 7 operations was rejected\.\]/);
	});

	it('alternates roles, tells it what the person did and how each proposal ended', () => {
		let state: WizardState = startState(FILE);
		state = {
			...state,
			messages: [
				...state.messages,
				{ id: 'x1', role: 'note', text: 'Split accepted: 2 processes.' }
			]
		};
		const messages = history(state, 'Draft Birth registration from its cells.');
		expect(
			messages.map((m) =>
				HumanMessage.isInstance(m) ? 'user' : AIMessage.isInstance(m) ? 'ai' : '?'
			)
		).toEqual(['user', 'ai', 'user']);
		expect(messages[2]!.content).toBe(
			'[Split accepted: 2 processes.]\n\nDraft Birth registration from its cells.'
		);
	});
});

describe('a turn on a hosted model, fast and in the open', () => {
	it('records a split whose processes arrive as a JSON string, without another round trip', async () => {
		const { ctx, model } = context([
			call('propose_split', {
				processes: JSON.stringify([birth, claims]),
				shared: JSON.stringify([{ ...documents, sources: JSON.stringify(documents.sources) }])
			}),
			answer('Two processes and the documents.')
		]);
		const state = await wizard.proposeSplit(ctx, startState(FILE));
		expect(model.remaining).toBe(0);
		expect(state.split?.processes.map((p) => p.title)).toEqual([
			'Birth registration',
			'Medical claims'
		]);
		expect(state.split?.shared).toEqual([documents]);
	});

	it('takes a tool input streamed with stray text after it as the call it is', async () => {
		const input = JSON.stringify({ processes: [birth, claims] });
		expect(leadingObject(`${input}</invoke>\n}`)).toEqual({ processes: [birth, claims] });
		expect(leadingObject(`${input}}`)).toEqual({ processes: [birth, claims] });
		expect(leadingObject('{"a": "}"}')).toEqual({ a: '}' });
		expect(leadingObject(`${input}${input}`)).toBeUndefined();
		expect(leadingObject('{"processes": [')).toBeUndefined();

		const { ctx, model } = context([
			() =>
				new AIMessage({
					content: '',
					invalid_tool_calls: [
						{
							name: 'propose_split',
							args: `${input}</invoke>\n}`,
							id: 'call_broken',
							error: 'Malformed args.',
							type: 'invalid_tool_call'
						}
					]
				}),
			answer('Two processes.')
		]);
		const state = await wizard.proposeSplit(ctx, startState(FILE));
		expect(model.remaining).toBe(0);
		expect(state.split?.processes.map((p) => p.title)).toEqual([
			'Birth registration',
			'Medical claims'
		]);
	});

	it('records a split sent whole as the value of its first argument', async () => {
		const whole = { processes: [birth, claims], shared: [documents] };
		for (const processes of [JSON.stringify(whole), whole]) {
			const { ctx, model } = context([
				call('propose_split', { processes }),
				answer('Two processes and the documents.')
			]);
			const state = await wizard.proposeSplit(ctx, startState(FILE));
			expect(model.remaining).toBe(0);
			expect(state.split?.processes.map((p) => p.title)).toEqual([
				'Birth registration',
				'Medical claims'
			]);
			expect(state.split?.shared).toEqual([documents]);
		}
	});

	it('reads only the cells asked for, saying which could not be read', async () => {
		const { ctx } = context([
			call('read_cells', {
				ranges: [
					{ sheet: 'Claims', range: 'A2:F3' },
					{ sheet: 'Nope', range: 'A1' }
				]
			}),
			(messages) => {
				const result = lastToolResult(messages);
				expect(result).toContain('Claims!A2:F3');
				expect(result).not.toContain('Gather the family document set');
				expect(result).toMatch(/Not read:\n- Nope!A1: there is no sheet "Nope"/);
				return call('propose_split', { processes: [claims] })(messages);
			},
			answer('One process.')
		]);
		const state = await wizard.proposeSplit(ctx, startState(FILE));
		expect(state.split?.processes).toHaveLength(1);
	});

	it('sends the draft with the request and asks for the whole change in one call', async () => {
		const { state: split, drafts } = await acceptedSplit();
		const { ctx, model } = context(
			[call('apply_operations', { operations: firstDraft }), answer('Drafted.')],
			drafts
		);
		await wizard.draft(ctx, split, split.activeKey!);
		const asked = String(model.sent[0]!.at(-1)!.content);
		expect(asked).toContain('Call apply_operations once with all of it');
		expect(asked).toMatch(/The draft now:\n\{"process":"Birth registration"/);
		expect(asked).toContain('"id":"process.birth-registration"');
	});

	it('still asks a lenient local model for one kind of node at a time', async () => {
		const { state: split, drafts } = await acceptedSplit();
		const { ctx, model } = context(
			[call('apply_operations', { operations: firstDraft }), answer('Drafted.')],
			drafts,
			{ lenient: true }
		);
		await wizard.draft(ctx, split, split.activeKey!);
		expect(String(model.sent[0]!.at(-1)!.content)).toContain('Call apply_operations three times');
	});

	// The scripted model streams in timed pieces, about 4 seconds in all, so allow more than the
	// default 5 seconds.
	it(
		'says what it is doing and shows what it proposes while the model is still writing',
		{
			timeout: 30_000
		},
		async () => {
			const activities: string[] = [];
			const lives: LiveTurn[] = [];
			const model = new StreamingScriptedModel(
				[
					() =>
						new AIMessage({
							content: 'I will propose one process per sheet.',
							tool_calls: [
								{
									name: 'read_cells',
									args: { ranges: [{ sheet: 'Claims', range: 'A2:F8' }] },
									id: 'r1',
									type: 'tool_call'
								}
							]
						}),
					call('propose_split', { processes: [birth, passport, claims], shared: [documents] }),
					answer('Three processes, plus the documents.')
				],
				24,
				40
			);
			const drafts = memoryDrafts();
			const ctx: AgentContext = {
				model,
				drafts,
				workbook,
				onProgress: (a) => activities.push(a),
				onLive: (l) => lives.push(structuredClone(l))
			};
			let state = await wizard.proposeSplit(ctx, startState(FILE));
			expect(activities[0]).toBe('Reading the spreadsheet');
			expect(activities).toContain('Reading the Claims sheet');
			expect(lives.some((l) => l.text === 'I will propose one process per sheet.')).toBe(true);
			// Processes show as they are written, before the tool has checked the split.
			const checking = activities.indexOf('Checking the 3 proposed processes');
			expect(activities.slice(0, checking)).toContain('Proposing 1 process');
			expect(activities.slice(0, checking)).toContain('Proposing 2 processes');
			expect(lives.at(-1)!.items).toEqual([
				{ kind: 'process', title: 'Birth registration' },
				{ kind: 'process', title: 'Child passport and ID' },
				{ kind: 'process', title: 'Medical claims' },
				{ kind: 'shared', title: 'Shared document set' }
			]);
			expect(state.split?.processes).toHaveLength(3);

			state = await wizard.acceptSplit(drafts, state, 'ns-1');
			activities.length = 0;
			lives.length = 0;
			model.script.push(call('apply_operations', { operations: firstDraft }), answer('Drafted.'));
			state = await wizard.draft(ctx, state, state.activeKey!);
			expect(activities[0]).toBe('Reading the cells of Birth registration');
			const midway = lives.filter((l) => l.items.length > 0 && l.items.length < firstDraft.length);
			expect(midway.length).toBeGreaterThan(0);
			expect(activities).toContain('Checking 7 proposed changes');
			expect(activities.some((a) => /^Proposing 2 stages, 1 role and \d facts?$/.test(a))).toBe(
				true
			);
			expect(lives.at(-1)!.items.map((i) => `${i.kind}: ${i.title}`)).toEqual([
				'stage: Before the birth',
				'stage: Registration',
				'role: Parent',
				'fact: Home address',
				'fact: Birth certificate',
				'step: Gather the family document set',
				'step: Register the birth'
			]);
			expect(pendingTurn(state, state.activeKey!)?.ops).toEqual(firstDraft);
		}
	);
});
