import { describe, expect, it } from 'vitest';
import { applyBatch } from '@casebook/model';
import { incidentManagement } from '@casebook/model/fixtures';
import { indexDocument } from './derive';
import { buildBoard, columnAt, GHOST_ID, type BoardCardData, type BoardEdgeData } from './board';

const ix = indexDocument(incidentManagement);
const board = buildBoard(ix);
const card = (id: string) => board.nodes.find((n) => n.id === id)!;
const edge = (id: string) => board.edges.find((e) => e.id === id);

describe('board layout', () => {
	it('draws one column per stage in stage order, then the "Add stage" column', () => {
		const columns = board.nodes.filter((n) => n.type === 'stage');
		expect(columns.map((c) => c.id)).toEqual(ix.stages.map((s) => s.core.id));
		for (let i = 1; i < columns.length; i++)
			expect(columns[i].position.x).toBeGreaterThan(columns[i - 1].position.x);
		const ghost = board.nodes.find((n) => n.id === GHOST_ID)!;
		expect(ghost.position.x).toBeGreaterThan(columns.at(-1)!.position.x);
	});

	it('shows a stage with nothing in it yet', () => {
		const added = applyBatch(incidentManagement, [
			{
				op: 'add_node',
				node: { core: { id: 'stage.follow-up', kind: 'stage', title: 'Follow up' } }
			}
		]);
		if (!added.ok) throw new Error(added.reason);
		const empty = buildBoard(indexDocument(added.document)).nodes.find(
			(n) => n.id === 'stage.follow-up'
		);
		expect(empty?.data).toMatchObject({ title: 'Follow up', count: 0 });
	});

	it('puts every card inside its own stage column, and a step that waits for another in its stage to its right', () => {
		for (const item of ix.work) {
			const { position } = card(item.core.id);
			const column = columnAt(board.columns, position)!;
			expect(column.id).toBe(item.core.stage);
		}
		expect(card('decision.classify-severity').position.x).toBeGreaterThan(
			card('step.report-incident').position.x
		);
		// parallel steps in one stage stack
		expect(card('step.post-status-update').position.x).toBe(
			card('step.form-working-group').position.x
		);
	});

	it('draws a link from the fact row it hands over, and a branch from its choice row', () => {
		expect(edge('step.report-incident->decision.classify-severity')?.sourceHandle).toBe(
			'f:fact.incident-summary'
		);
		const rows = (card('decision.classify-severity').data as BoardCardData).rows.map(
			(r) => r.title
		);
		expect(rows).toEqual(['SEV1', 'SEV2', 'SEV3', 'SEV4']);
	});

	it('routes a link over the top of the board when a card is in the way, never behind it', () => {
		const around = edge('decision.classify-severity->step.resolve-incident');
		expect((around?.data as BoardEdgeData).route?.mode).toBe('top');
		const direct = edge('step.resolve-incident->step.write-rca');
		expect((direct?.data as BoardEdgeData).route?.mode).not.toBe('top');
	});

	it('marks a card with nothing after it, so its "+" stays visible as the place to continue', () => {
		expect((card('step.notify-downstream').data as BoardCardData).leaf).toBe(true);
		expect((card('step.report-incident').data as BoardCardData).leaf).toBe(false);
	});
});
