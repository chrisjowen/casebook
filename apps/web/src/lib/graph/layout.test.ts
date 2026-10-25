import { describe, expect, it } from 'vitest';
import { incidentManagement } from '../../../../../packages/model/fixtures/index.ts';
import { indexDocument } from './derive';
import { build, buildMap } from './layout';

const ix = indexDocument(incidentManagement);

describe('layouts', () => {
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
