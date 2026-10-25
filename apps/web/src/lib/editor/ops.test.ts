import { describe, expect, it } from 'vitest';
import { applyBatch, type DefinitionDocument, type StageId } from '@casebook/model';
import { incidentManagement } from '@casebook/model/fixtures';
import * as edits from './ops';

const apply = (document: DefinitionDocument, edit: edits.Edit) => {
	const result = applyBatch(document, edit.ops);
	if (!result.ok) throw new Error(result.reason);
	return result.document;
};
const node = (document: DefinitionDocument, id: string | undefined) =>
	document.nodes.find((n) => n.core.id === id);

describe('editor edits', () => {
	const doc = incidentManagement;

	it('numbers fresh ids when one is taken', () => {
		expect(edits.freshId(doc, 'stage', 'Detect')).toBe('stage.detect-2');
		expect(edits.freshId(doc, 'step', 'Brand new!')).toBe('step.brand-new');
	});

	it('adds a step after another, in its stage and role', () => {
		const edit = edits.addStepAfter(doc, 'step.write-rca');
		const added = node(apply(doc, edit), edit.select);
		const rca = node(doc, 'step.write-rca');
		expect(added?.core).toMatchObject({
			kind: 'step',
			stage: (rca?.core as { stage: string }).stage,
			role: (rca?.core as { role: string }).role
		});
	});

	it('adds a fact the step collects, and selects it to name', () => {
		const edit = edits.addFact(doc, 'step.write-rca');
		const after = apply(doc, edit);
		expect(node(after, edit.select)?.core.kind).toBe('fact');
		const rca = node(after, 'step.write-rca')?.core as { collects?: { fact: string }[] };
		expect(rca.collects?.map((c) => c.fact)).toContain(edit.select);
	});

	it('adds a condition, duplicates and deletes a step', () => {
		const step = doc.nodes.find((n) => n.core.kind === 'step' && !('when' in n.core))!;
		const withCondition = apply(doc, edits.addCondition(doc, step.core.id));
		expect((node(withCondition, step.core.id)?.core as { when?: unknown }).when).toBeDefined();

		const copy = edits.duplicate(doc, step.core.id);
		const duplicated = apply(doc, copy);
		expect(node(duplicated, copy.select)?.core.title).toBe(`${step.core.title} (copy)`);
		expect(node(apply(duplicated, edits.remove(copy.select!)), copy.select)).toBeUndefined();
	});

	it('adds stages, roles and a step in a new stage', () => {
		const withStage = apply(doc, edits.addStage(doc));
		const stage = node(withStage, 'stage.new-stage')!;
		const withStep = apply(withStage, edits.addStep(withStage, stage.core.id as StageId));
		expect(
			withStep.nodes.some((n) => n.core.kind === 'step' && n.core.stage === stage.core.id)
		).toBe(true);
		expect(apply(doc, edits.addRole(doc)).nodes.filter((n) => n.core.kind === 'role')).toHaveLength(
			doc.nodes.filter((n) => n.core.kind === 'role').length + 1
		);
	});
});
