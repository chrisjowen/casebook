import { describe, expect, it } from 'vitest';
import { incidentManagement } from '../../fixtures/index.js';
import {
	attributionProblem,
	commit,
	revert,
	startHistory,
	undo,
	type Attribution,
	type CommitResult,
	type Operation,
	type Revision
} from '../../src/index.js';

const alice: Attribution = { author: { id: 'u-alice', kind: 'user' } };
const wizard: Attribution = {
	author: { id: 'a-wizard', kind: 'agent' },
	onBehalfOf: { id: 'u-alice', kind: 'user' }
};
const at = new Date('2026-10-25T09:00:00Z');

function revisionOf(result: CommitResult): Revision {
	if (!result.ok) throw new Error(result.reason);
	return result.revision;
}

const rename: Operation = { op: 'update_core', id: 'stage.detect', changes: { title: 'Triage' } };
const move: Operation = {
	op: 'move_to_stage',
	id: 'step.resolve-incident',
	stage: 'stage.respond'
};

/** Revision 1 is the fixture, 2 renames a stage, 3 moves a step. */
function history(): Revision[] {
	const first = revisionOf(startHistory(incidentManagement, alice, at));
	const second = revisionOf(commit(first, [rename], wizard, at));
	const third = revisionOf(commit(second, [move], alice, at));
	return [first, second, third];
}

describe('revisions', () => {
	it('starts a history at revision 1 and records who made each edit', () => {
		const [first, second] = history();
		expect(first).toEqual({
			number: 1,
			document: incidentManagement,
			ops: [],
			author: alice.author,
			createdAt: '2026-10-25T09:00:00.000Z'
		});
		expect(second).toMatchObject({
			number: 2,
			ops: [rename],
			author: { id: 'a-wizard', kind: 'agent' },
			onBehalfOf: { id: 'u-alice', kind: 'user' }
		});
		expect(second?.document.nodes.find((n) => n.core.id === 'stage.detect')?.core.title).toBe(
			'Triage'
		);
	});

	it('does not start a history from a document with a broken reference', () => {
		const broken = {
			...incidentManagement,
			nodes: incidentManagement.nodes.filter((n) => n.core.id !== 'stage.detect')
		};
		expect(startHistory(broken, alice, at)).toMatchObject({ ok: false, code: 'broken-reference' });
	});

	it('returns warnings with each new revision', () => {
		const [first] = history();
		const result = commit(
			first as Revision,
			[
				{
					op: 'unlink',
					from: 'step.report-incident',
					edge: 'collects',
					to: 'fact.incident-summary'
				}
			],
			alice,
			at
		);
		expect(result.ok && result.warnings.map((w) => w.code)).toEqual(['uncollected-fact']);
	});

	it('rejects an edit that is refused, or that changes nothing', () => {
		const [first] = history() as [Revision];
		expect(commit(first, [{ op: 'remove_node', id: 'fact.severity' }], alice, at)).toMatchObject({
			ok: false,
			code: 'referenced'
		});
		expect(commit(first, [], alice, at)).toMatchObject({ ok: false, code: 'no-change' });
		expect(
			commit(
				first,
				[
					{ op: 'set_content', id: 'stage.detect', content: 'x' },
					{ op: 'set_content', id: 'stage.detect', content: null }
				],
				alice,
				at
			)
		).toMatchObject({ ok: false, code: 'no-change' });
	});

	it.each<[string, Attribution, string | undefined]>([
		['a user acting for themselves', alice, undefined],
		['an agent acting for a user', wizard, undefined],
		[
			'a service acting for a group',
			{ author: { id: 's-import', kind: 'service' }, onBehalfOf: { id: 'g-sre', kind: 'group' } },
			undefined
		],
		[
			'a user acting for someone else',
			{ author: alice.author, onBehalfOf: { id: 'u-bob', kind: 'user' } },
			'a user edits on their own behalf, so onBehalfOf must not be set'
		],
		[
			'an agent acting for nobody',
			{ author: { id: 'a-wizard', kind: 'agent' } },
			'an agent must record who it acts on behalf of'
		],
		[
			'an agent acting for an agent',
			{ author: { id: 'a-wizard', kind: 'agent' }, onBehalfOf: { id: 'a-other', kind: 'agent' } },
			'an agent cannot act on behalf of another agent'
		],
		[
			'a group as author',
			{ author: { id: 'g-sre', kind: 'group' } },
			'a group cannot author an edit; record the user or agent who made it'
		]
	])('checks attribution: %s', (_name, attribution, problem) => {
		expect(attributionProblem(attribution)).toBe(problem);
		const [first] = history() as [Revision];
		const result = commit(first, [rename], attribution, at);
		if (problem === undefined) {
			expect(result.ok).toBe(true);
		} else {
			expect(result).toMatchObject({
				ok: false,
				code: 'invalid-attribution',
				reason: `Cannot record this edit: ${problem}`
			});
		}
	});
});

describe('undo and revert', () => {
	it('undoes the latest edit as a new revision', () => {
		const revisions = history();
		const undone = revisionOf(undo(revisions, alice, at));
		expect(undone).toMatchObject({ number: 4, ops: [], revertedTo: 2 });
		expect(undone.document).toEqual(revisions[1]?.document);
	});

	it('keeps stepping back when undo is repeated', () => {
		const revisions = history();
		const fourth = revisionOf(undo(revisions, alice, at));
		const fifth = revisionOf(undo([...revisions, fourth], alice, at));
		expect(fifth).toMatchObject({ number: 5, revertedTo: 1 });
		expect(fifth.document).toEqual(incidentManagement);
		expect(undo([...revisions, fourth, fifth], alice, at)).toMatchObject({
			ok: false,
			code: 'nothing-to-undo'
		});
	});

	it('undoes an edit made after an undo by going back to the revision before it', () => {
		const revisions = history();
		const fourth = revisionOf(undo(revisions, alice, at));
		const fifth = revisionOf(
			commit(fourth, [{ op: 'set_content', id: 'stage.detect', content: 'Spot it.' }], alice, at)
		);
		const sixth = revisionOf(undo([...revisions, fourth, fifth], alice, at));
		expect(sixth).toMatchObject({ revertedTo: 4 });
		expect(sixth.document).toEqual(revisions[1]?.document);
	});

	it('reverts to any earlier revision', () => {
		const revisions = history();
		const reverted = revisionOf(revert(revisions, 1, wizard, at));
		expect(reverted).toMatchObject({ number: 4, revertedTo: 1, author: wizard.author });
		expect(reverted.document).toEqual(incidentManagement);
	});

	it('rejects reverting to an unknown revision, or to the current document', () => {
		const revisions = history();
		expect(revert(revisions, 9, alice, at)).toMatchObject({ ok: false, code: 'unknown-revision' });
		expect(revert(revisions, 3, alice, at)).toMatchObject({ ok: false, code: 'no-change' });
		expect(undo(revisions.slice(0, 1), alice, at)).toMatchObject({
			ok: false,
			code: 'nothing-to-undo'
		});
	});
});
