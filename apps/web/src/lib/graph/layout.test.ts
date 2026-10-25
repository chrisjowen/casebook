import { describe, expect, it } from 'vitest';
import { incidentManagement } from '../../../../../packages/model/fixtures/index.ts';
import { indexDocument } from './derive';
import { build, buildMap } from './layout';

const ix = indexDocument(incidentManagement);

describe('layouts', () => {
	it('step cards: one card per work item inside its stage, edges leave from the fact row', async () => {
		const { nodes, edges } = await build('cards', ix);
		const cards = nodes.filter((n) => n.type === 'card');
		expect(cards.map((n) => n.id).sort()).toEqual(ix.work.map((w) => w.core.id).sort());
		for (const card of cards)
			expect(card.parentId).toBe(ix.work.find((w) => w.core.id === card.id)!.core.stage);
		const handOff = edges.find(
			(e) => e.id === 'decision.classify-severity->step.form-working-group'
		);
		expect(handOff?.sourceHandle).toBe('f:fact.severity');
		expect((handOff?.data as { points?: unknown[] }).points?.length).toBeGreaterThan(1);
	});

	it('role lanes: cards sit inside the lane of their role', async () => {
		const { nodes } = await build('lanes', ix);
		for (const item of ix.work)
			expect(nodes.find((n) => n.id === item.core.id)?.parentId).toBe(`lane:${item.core.role}`);
	});

	it('fact flow: facts and work items are both nodes', async () => {
		const { nodes, edges } = await build('facts', ix);
		expect(nodes.filter((n) => n.type === 'fact').length).toBe(ix.facts.length);
		expect(nodes.filter((n) => n.type === 'compact').length).toBe(ix.work.length);
		expect(edges.length).toBeGreaterThan(ix.work.length);
	});

	it('workspace map: one card per definition', async () => {
		const { nodes } = await buildMap([ix]);
		expect(nodes.map((n) => n.id)).toEqual(['incident-management']);
	});
});
