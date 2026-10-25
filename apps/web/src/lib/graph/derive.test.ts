import { describe, expect, it } from 'vitest';
import type { DefinitionDocument } from '@casebook/model';
import {
	birthRegistrationAbroad,
	incidentManagement,
	uncollectedFact
} from '../../../../../packages/model/fixtures/index.ts';
import {
	describeEvidence,
	factFlow,
	factType,
	handOffs,
	humanizeDuration,
	humanizeId,
	indexDocument,
	labelOf,
	laneGrid,
	missingInputs,
	plainText,
	processLinks,
	reduceTransitive,
	sharedFactTypes,
	type WorkItem
} from './derive';

const incident = indexDocument(incidentManagement);

describe('hand-offs from requires and collects', () => {
	const edges = handOffs(incident);
	const edge = (from: string, to: string) => edges.find((e) => e.from === from && e.to === to);

	it('runs from the step that collects a fact to every item that requires it', () => {
		expect(edge('step.report-incident', 'decision.classify-severity')?.facts).toEqual([
			'fact.incident-summary',
			'fact.affected-services'
		]);
		expect(edge('step.resolve-incident', 'step.write-rca')?.facts).toEqual([
			'fact.resolution-summary'
		]);
	});

	it('treats a decision outcome as collected by the decision', () => {
		expect(edge('decision.classify-severity', 'step.form-working-group')?.facts).toEqual([
			'fact.severity'
		]);
		expect(edge('decision.classify-severity', 'step.post-status-update')?.facts).toEqual([
			'fact.severity'
		]);
	});

	it('has no self edges and one edge per pair', () => {
		expect(edges.every((e) => e.from !== e.to)).toBe(true);
		expect(new Set(edges.map((e) => e.id)).size).toBe(edges.length);
	});

	it('hides transitive edges for display only', () => {
		const reduced = reduceTransitive(edges);
		// report -> resolve is implied by report -> classify -> resolve
		expect(
			edges.some((e) => e.from === 'step.report-incident' && e.to === 'step.notify-downstream')
		).toBe(true);
		expect(
			reduced.some((e) => e.from === 'step.report-incident' && e.to === 'step.notify-downstream')
		).toBe(false);
		expect(
			reduced.some(
				(e) => e.from === 'step.report-incident' && e.to === 'decision.classify-severity'
			)
		).toBe(true);
	});

	it('reports required facts nothing collects', () => {
		const broken = indexDocument(uncollectedFact);
		const blocked = broken.work.filter((w) => missingInputs(broken, w).length > 0);
		expect(blocked.length).toBeGreaterThan(0);
		expect(missingInputs(incident, incident.byId.get('step.write-rca') as WorkItem)).toEqual([]);
	});
});

describe('role lanes', () => {
	const grid = laneGrid(incident);
	const cell = (id: string) => {
		for (const lane of grid.lanes) {
			const c = lane.cells.find((x) => x.id === id);
			if (c) return { ...c, role: lane.role };
		}
		throw new Error(`no cell for ${id}`);
	};

	it('puts every work item in the lane of its role, and only roles with work get a lane', () => {
		for (const item of incident.work) expect(cell(item.core.id).role).toBe(item.core.role);
		expect(grid.lanes.map((l) => l.role)).not.toContain('role.engineering-director');
	});

	it('places each item right of everything it depends on', () => {
		for (const e of handOffs(incident)) expect(cell(e.to).col).toBeGreaterThan(cell(e.from).col);
	});

	it('stacks items that share a lane and a column', () => {
		const cells = grid.lanes.flatMap((l) => l.cells.map((c) => `${l.role}:${c.col}:${c.row}`));
		expect(new Set(cells).size).toBe(cells.length);
	});
});

describe('fact flow', () => {
	const flow = factFlow(incident);

	it('makes a node for every fact a work item collects or requires', () => {
		expect(flow.facts).toContain('fact.severity');
		expect(flow.facts).toContain('fact.rca-document');
		expect(flow.work).toHaveLength(incident.work.length);
	});

	it('links collectors to facts and facts to the items that need them', () => {
		expect(flow.edges).toContainEqual(
			expect.objectContaining({
				source: 'decision.classify-severity',
				target: 'fact:fact.severity',
				kind: 'collects'
			})
		);
		expect(flow.edges).toContainEqual(
			expect.objectContaining({
				source: 'fact:fact.severity',
				target: 'step.resolve-incident',
				kind: 'requires'
			})
		);
	});
});

describe('workspace map', () => {
	const consumer: DefinitionDocument = {
		...incidentManagement,
		slug: 'postmortem-follow-up',
		nodes: [
			{
				core: { id: 'process.postmortem-follow-up', kind: 'process', title: 'Postmortem follow-up' }
			},
			{ core: { id: 'stage.follow-up', kind: 'stage', title: 'Follow up' } },
			{ core: { id: 'role.service-owner', kind: 'role', title: 'Service owner' } },
			incidentManagement.nodes.find((n) => n.core.id === 'fact.rca-document')!,
			{
				core: {
					id: 'step.track-actions',
					kind: 'step',
					title: 'Track the actions',
					stage: 'stage.follow-up',
					role: 'role.service-owner',
					actor: 'human',
					requires: ['fact.rca-document']
				}
			}
		]
	};

	it('finds fact types declared by more than one definition', () => {
		const shared = sharedFactTypes([incidentManagement, consumer]);
		expect(shared.map((f) => f.title)).toEqual(['Root cause analysis']);
		expect(shared[0].uses.map((u) => u.process)).toEqual([
			'Incident management',
			'Postmortem follow-up'
		]);
	});

	it('links the collecting definition to the one that needs the fact', () => {
		expect(processLinks([incidentManagement, consumer])).toEqual([
			{
				id: 'incident-management->postmortem-follow-up',
				from: 'incident-management',
				to: 'postmortem-follow-up',
				facts: ['Root cause analysis']
			}
		]);
		expect(sharedFactTypes([incidentManagement, birthRegistrationAbroad])).toEqual([]);
	});
});

describe('plain language', () => {
	it('names nodes by title, or by a readable id', () => {
		expect(labelOf(incident, 'step.form-working-group')).toBe('Form the working group');
		expect(humanizeId('step.call-the-bridge')).toBe('Call the bridge');
	});

	it('describes fact types without schema jargon', () => {
		const type = (id: string) =>
			factType(incident.facts.find((f) => f.core.id === id)?.core.schema).label;
		expect(type('fact.severity')).toBe('Choice');
		expect(type('fact.working-group')).toBe('People');
		expect(type('fact.rca-document')).toBe('Document');
		expect(type('fact.resolved-at')).toBe('Date & time');
		expect(type('fact.downstream-notified')).toBe('Yes or no');
		expect(type('fact.affected-services')).toBe('Choices');
	});

	it('reads durations and evidence', () => {
		expect(humanizeDuration('PT30M')).toBe('30 minutes');
		expect(humanizeDuration('P1DT2H')).toBe('1 day 2 hours');
		expect(
			describeEvidence({ description: 'x', formats: ['original', 'certified-copy'], copies: 2 })
		).toBe('Original or certified copy, 2 copies');
	});

	it('replaces node ids in model messages with names', () => {
		expect(plainText(incident, 'fact.severity is required by step.resolve-incident')).toBe(
			'“Severity” is required by “Resolve the incident”'
		);
	});
});
