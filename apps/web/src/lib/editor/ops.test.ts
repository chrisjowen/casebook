import { describe, expect, it } from 'vitest';
import {
	applyBatch,
	type DefinitionDocument,
	type FactId,
	type FactNode,
	type StepNode
} from '@casebook/model';
import { incidentManagement } from '@casebook/model/fixtures';
import {
	collectsOf,
	factType,
	handOffs,
	indexDocument,
	requiresOf,
	type WorkItem
} from '$lib/graph/derive';
import { branchChoices } from '$lib/conditions/conditions';
import * as edits from './ops';

/** Applies one gesture's edit through the model, as the store does, and returns the new draft. */
const apply = (document: DefinitionDocument, edit: edits.Edit | string | undefined) => {
	if (edit === undefined || typeof edit === 'string') throw new Error(`no edit: ${edit}`);
	const result = applyBatch(document, edit.ops);
	if (!result.ok) throw new Error(result.reason);
	return result.document;
};
const node = (document: DefinitionDocument, id: string | undefined) =>
	document.nodes.find((n) => n.core.id === id);
const work = (document: DefinitionDocument, id: string) => node(document, id) as WorkItem;
const links = (document: DefinitionDocument) =>
	handOffs(indexDocument(document)).map((h) => `${h.from}->${h.to}`);
const stages = (document: DefinitionDocument) =>
	document.nodes.filter((n) => n.core.kind === 'stage').map((n) => n.core.id);
const facts = (document: DefinitionDocument) =>
	document.nodes.filter((n) => n.core.kind === 'fact');

const doc = incidentManagement;
const ix = indexDocument(doc);
const text = edits.FACT_KINDS[0].schema;

describe('adding on the board', () => {
	it('numbers fresh ids when one is taken', () => {
		expect(edits.freshId(doc, 'stage', 'Detect')).toBe('stage.detect-2');
		expect(edits.freshId(doc, 'step', 'Brand new!')).toBe('step.brand-new');
	});

	it('adds a named step to a stage, in one edit', () => {
		const edit = edits.addWork(doc, {
			kind: 'step',
			title: 'Page the owner',
			stage: 'stage.respond'
		});
		const after = apply(doc, edit);
		expect(edit.ops).toHaveLength(1);
		expect(node(after, edit.select)?.core).toMatchObject({
			kind: 'step',
			title: 'Page the owner',
			stage: 'stage.respond'
		});
		expect(edit.label).toBe('Added Page the owner to Respond');
	});

	it('adds a named decision with a Yes/No outcome it records', () => {
		const edit = edits.addWork(doc, {
			kind: 'decision',
			title: 'Escalate?',
			stage: 'stage.detect'
		});
		const after = apply(doc, edit);
		const decision = work(after, edit.id);
		expect(decision.core.kind).toBe('decision');
		const outcome = node(after, collectsOf(decision)[0].fact) as FactNode;
		expect(outcome.core).toMatchObject({
			title: 'Escalate? outcome',
			schema: { enum: ['Yes', 'No'] }
		});
	});

	it('adds a named stage after the last one', () => {
		const edit = edits.addStage(doc, 'Follow up');
		expect(stages(apply(doc, edit)).at(-1)).toBe(edit.id);
		expect(node(apply(doc, edit), edit.id)?.core.title).toBe('Follow up');
	});

	it('adds what comes next: it needs what the step before records, so they are linked', () => {
		const before = work(doc, 'step.resolve-incident');
		const edit = edits.addWork(doc, {
			kind: 'step',
			title: 'Close the ticket',
			stage: 'stage.resolve',
			requires: collectsOf(before).map((c) => c.fact)
		});
		expect(links(apply(doc, edit))).toContain(`step.resolve-incident->${edit.id}`);
	});

	it('puts a named step between two linked steps', () => {
		const link = handOffs(ix).find((h) => h.id === 'step.resolve-incident->step.write-rca')!;
		const edit = edits.insertBetween(doc, link, 'Collect timelines');
		const after = apply(doc, edit);
		expect(links(after)).toEqual(
			expect.arrayContaining([
				`step.resolve-incident->${edit.select}`,
				`${edit.select}->step.write-rca`
			])
		);
		expect(node(after, edit.select)?.core.title).toBe('Collect timelines');
	});
});

describe('linking is handing over facts', () => {
	it('dropping one step on another makes the second need what the first records', () => {
		const edit = edits.linkWork(ix, 'step.report-incident', 'step.notify-downstream')!;
		const after = apply(doc, edit);
		const notify = work(after, 'step.notify-downstream');
		for (const { fact } of collectsOf(work(doc, 'step.report-incident')))
			expect(requiresOf(notify)).toContain(fact);
		expect(edit.label).toMatch(/^Notify downstream teams now needs .* from Report the incident$/);
	});

	it('offers nothing to link when the first step records nothing new for the second', () => {
		const once = apply(doc, edits.linkWork(ix, 'step.report-incident', 'step.notify-downstream'));
		expect(
			edits.linkWork(indexDocument(once), 'step.report-incident', 'step.notify-downstream')
		).toBeUndefined();
	});

	it('dragging a fact onto a step makes it need that fact', () => {
		const after = apply(doc, edits.setNeeds(ix, 'step.write-rca', 'fact.incident-summary', true));
		expect(requiresOf(work(after, 'step.write-rca'))).toContain('fact.incident-summary');
	});

	it("linking a decision's choice makes the step run only for that choice", () => {
		const after = apply(
			doc,
			edits.branchTo(ix, 'decision.classify-severity', 'SEV1', 'step.notify-downstream')
		);
		const notify = work(after, 'step.notify-downstream');
		expect(requiresOf(notify)).toContain('fact.severity');
		expect(notify.core.when?.text).toBe('Only when Classify severity is SEV1');
		const branched = indexDocument(after);
		expect(branchChoices(branched, work(after, 'decision.classify-severity'), notify)).toEqual([
			'SEV1'
		]);
		expect(links(after)).toContain('decision.classify-severity->step.notify-downstream');
	});

	it('removing a link stops the later step needing what the earlier one hands over', () => {
		const link = handOffs(ix).find((h) => h.id === 'step.resolve-incident->step.write-rca')!;
		expect(links(apply(doc, edits.unlinkHandOff(ix, link)))).not.toContain(link.id);
	});
});

describe('a step’s Records and Needs first', () => {
	it('adds a new fact a step records, by name and kind', () => {
		const date = edits.FACT_KINDS.findIndex((k) => k.label === 'Date');
		const after = apply(
			doc,
			edits.addFactByName(
				ix,
				'step.write-rca',
				'records',
				'Review date',
				edits.FACT_KINDS[date].schema
			)
		);
		const rca = work(after, 'step.write-rca');
		const fact = collectsOf(rca)
			.map((c) => node(after, c.fact) as FactNode)
			.find((f) => f.core.title === 'Review date');
		expect(factType(fact?.core.schema).label).toBe('Date');
	});

	it('reuses a fact of the same name instead of making a duplicate, and says when it is already there', () => {
		const after = apply(
			doc,
			edits.addFactByName(ix, 'step.write-rca', 'records', 'severity', text)
		);
		expect(facts(after)).toHaveLength(facts(doc).length);
		expect(collectsOf(work(after, 'step.write-rca')).map((c) => c.fact)).toContain('fact.severity');
		expect(
			edits.addFactByName(ix, 'step.report-incident', 'records', 'Incident summary', text)
		).toBe('Report the incident already records Incident summary');
	});

	it('adds something a step needs by name; a new name is flagged as not recorded yet', () => {
		const existing = apply(
			doc,
			edits.addFactByName(ix, 'step.notify-downstream', 'needs', 'Severity', text)
		);
		expect(links(existing)).toContain('decision.classify-severity->step.notify-downstream');
		const fresh = apply(
			doc,
			edits.addFactByName(ix, 'step.notify-downstream', 'needs', 'Customer list', text)
		);
		const issues = applyBatch(
			doc,
			(
				edits.addFactByName(
					ix,
					'step.notify-downstream',
					'needs',
					'Customer list',
					text
				) as edits.Edit
			).ops
		);
		expect(issues.ok && issues.warnings.map((w) => w.code)).toContain('uncollected-fact');
		expect(facts(fresh)).toHaveLength(facts(doc).length + 1);
	});

	it('renames a fact in place, everywhere it is used', () => {
		const after = apply(doc, edits.renameNode(ix, 'fact.incident-summary', 'What happened'));
		expect(node(after, 'fact.incident-summary')?.core.title).toBe('What happened');
	});

	it('renaming a new decision renames its outcome with it', () => {
		const added = edits.addWork(doc, {
			kind: 'decision',
			title: 'New decision',
			stage: 'stage.detect'
		});
		const withDecision = apply(doc, added);
		const after = apply(
			withDecision,
			edits.renameNode(indexDocument(withDecision), added.id, 'Escalate')
		);
		const outcome = collectsOf(work(after, added.id))[0].fact;
		expect(node(after, outcome)?.core.title).toBe('Escalate outcome');
	});

	it('changes a fact’s kind in place', () => {
		const number = edits.FACT_KINDS.findIndex((k) => k.label === 'Number');
		const after = apply(doc, edits.setFactKind(ix, 'fact.incident-summary', number));
		expect(factType((node(after, 'fact.incident-summary') as FactNode).core.schema).label).toBe(
			'Number'
		);
	});

	it('removing a fact nothing else uses deletes it; one used elsewhere is only taken off this step', () => {
		const added = edits.addFactByName(
			ix,
			'step.write-rca',
			'records',
			'Scratch notes',
			text
		) as edits.Edit & { id: FactId };
		const withNotes = apply(doc, added);
		const gone = apply(
			withNotes,
			edits.removeFromList(indexDocument(withNotes), 'step.write-rca', 'records', added.id)
		);
		expect(node(gone, added.id)).toBeUndefined();

		const kept = apply(
			doc,
			edits.removeFromList(ix, 'step.resolve-incident', 'records', 'fact.resolution-summary')
		);
		expect(node(kept, 'fact.resolution-summary')).toBeDefined();
		expect(collectsOf(work(kept, 'step.resolve-incident')).map((c) => c.fact)).not.toContain(
			'fact.resolution-summary'
		);
	});

	it('removing a fact a rule or an assignment still reads only takes it off this step', () => {
		const resolved = apply(
			doc,
			edits.removeFromList(ix, 'step.resolve-incident', 'records', 'fact.resolved-at')
		);
		expect(node(resolved, 'fact.resolved-at')).toBeDefined();
		expect(collectsOf(work(resolved, 'step.resolve-incident')).map((c) => c.fact)).not.toContain(
			'fact.resolved-at'
		);

		const group = apply(
			doc,
			edits.removeFromList(ix, 'step.form-working-group', 'records', 'fact.working-group')
		);
		expect(node(group, 'fact.working-group')).toBeDefined();
		expect(collectsOf(work(group, 'step.form-working-group')).map((c) => c.fact)).not.toContain(
			'fact.working-group'
		);
	});

	it('removing something a step needs takes the link away', () => {
		const after = apply(
			doc,
			edits.removeFromList(ix, 'step.write-rca', 'needs', 'fact.resolution-summary')
		);
		expect(requiresOf(work(after, 'step.write-rca'))).not.toContain('fact.resolution-summary');
	});
});

describe('moving and removing', () => {
	it('moves a step to another stage', () => {
		const after = apply(doc, edits.moveToStage(ix, 'step.write-rca', 'stage.resolve'));
		expect((node(after, 'step.write-rca') as StepNode).core.stage).toBe('stage.resolve');
	});

	it('moves a stage left and right, and says when it is already at the end', () => {
		expect(stages(apply(doc, edits.shiftStage(ix, 'stage.review', -1)))).toEqual([
			'stage.detect',
			'stage.respond',
			'stage.review',
			'stage.resolve'
		]);
		expect(stages(apply(doc, edits.shiftStage(ix, 'stage.detect', 1)))).toEqual([
			'stage.respond',
			'stage.detect',
			'stage.resolve',
			'stage.review'
		]);
		expect(stages(apply(doc, edits.shiftStage(ix, 'stage.resolve', 1))).at(-1)).toBe(
			'stage.resolve'
		);
		expect(edits.shiftStage(ix, 'stage.detect', -1)).toBe('Detect is already the first stage');
	});

	it('deletes a stage, moving its steps to the stage beside it', () => {
		const after = apply(doc, edits.removeStage(ix, 'stage.resolve'));
		expect(stages(after)).not.toContain('stage.resolve');
		expect((node(after, 'step.resolve-incident') as StepNode).core.stage).toBe('stage.respond');
	});

	it('deletes a fact everywhere, but not a decision’s outcome', () => {
		const after = apply(doc, edits.removeFact(ix, 'fact.incident-summary'));
		expect(node(after, 'fact.incident-summary')).toBeUndefined();
		expect(edits.removeFact(ix, 'fact.severity')).toBe(
			'Severity is what Classify severity decides; delete the decision instead'
		);
	});

	it('says why a fact a rule or an assignment reads cannot be deleted', () => {
		expect(edits.removeFact(ix, 'fact.resolved-at')).toMatch(
			/^Resolved at is still used by Post a status update/
		);
		expect(edits.removeFact(ix, 'fact.working-group')).toMatch(
			/^Working group is still used by Form the working group/
		);
	});

	it('deletes a step with the approval only it uses, and duplicates one', () => {
		const after = apply(doc, edits.removeWork(ix, 'step.write-rca'));
		expect(node(after, 'step.write-rca')).toBeUndefined();
		expect(after.nodes.some((n) => n.core.kind === 'approval')).toBe(false);
		const copy = edits.duplicate(doc, 'step.notify-downstream');
		expect(node(apply(doc, copy), copy.select)?.core.title).toBe('Notify downstream teams (copy)');
	});

	it('adds and removes an approval and a role', () => {
		const step = 'step.resolve-incident';
		const approved = apply(doc, edits.addApproval(doc, step));
		expect((node(approved, step) as StepNode).core.approval).toBeDefined();
		const without = apply(approved, edits.removeApproval(indexDocument(approved), step));
		expect((node(without, step) as StepNode).core.approval).toBeUndefined();
		expect(apply(doc, edits.addRole(doc)).nodes.filter((n) => n.core.kind === 'role')).toHaveLength(
			ix.roles.length + 1
		);
	});
});
