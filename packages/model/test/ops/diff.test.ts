import { describe, expect, it } from 'vitest';
import { birthRegistrationAbroad, incidentManagement } from '../../fixtures/index.js';
import {
	applyBatch,
	diff,
	summarize,
	type DefinitionDocument,
	type Operation
} from '../../src/index.js';

function edited(document: DefinitionDocument, ops: Operation[]): DefinitionDocument {
	const result = applyBatch(document, ops);
	if (!result.ok) throw new Error(result.reason);
	return result.document;
}

function summaryOf(document: DefinitionDocument, ops: Operation[]): string[] {
	return summarize(diff(document, edited(document, ops)));
}

describe('diff', () => {
	it('finds nothing between a document and itself, or a reordered copy', () => {
		expect(diff(incidentManagement, incidentManagement)).toEqual([]);
		const reordered = { ...incidentManagement, nodes: [...incidentManagement.nodes].reverse() };
		expect(diff(incidentManagement, reordered)).toEqual([]);
	});

	it('tells apart required and collected facts that share a title', () => {
		const twin = (id: string, title: string) =>
			({
				op: 'add_node',
				node: { core: { id, kind: 'fact', title, schema: { type: 'string' } } }
			}) as const;
		const summary = summaryOf(incidentManagement, [
			twin('fact.severity-copy', 'Severity'),
			twin('fact.rca-copy', 'Root cause analysis'),
			{
				op: 'update_core',
				id: 'step.write-rca',
				changes: {
					requires: ['fact.severity-copy', 'fact.resolution-summary'],
					collects: [{ fact: 'fact.rca-copy' }]
				}
			}
		]);
		expect(summary).toContain(
			'Step Write the root cause analysis now requires fact Severity and no longer requires fact Severity'
		);
		expect(summary).toContain(
			'Step Write the root cause analysis now collects fact Root cause analysis and no longer collects fact Root cause analysis'
		);
	});

	it('reports an added node with its kind and title', () => {
		const node = {
			core: {
				id: 'step.page-leadership',
				kind: 'step',
				title: 'Page leadership',
				stage: 'stage.respond',
				role: 'role.incident-commander',
				actor: 'agent'
			}
		} as const;
		const changes = diff(
			incidentManagement,
			edited(incidentManagement, [{ op: 'add_node', node }])
		);
		expect(changes).toEqual([
			{
				type: 'node-added',
				nodeId: 'step.page-leadership',
				kind: 'step',
				node,
				summary: 'Added step Page leadership'
			}
		]);
	});

	it('reports a removed node', () => {
		expect(
			summaryOf(incidentManagement, [{ op: 'remove_node', id: 'step.notify-downstream' }])
		).toEqual(['Removed step Notify downstream teams']);
	});

	it('reports one change per field, with before and after values', () => {
		const changes = diff(
			incidentManagement,
			edited(incidentManagement, [
				{ op: 'move_to_stage', id: 'step.write-rca', stage: 'stage.resolve' },
				{ op: 'update_core', id: 'step.write-rca', changes: { actor: 'human' } }
			])
		);
		expect(changes).toEqual([
			{
				type: 'node-changed',
				nodeId: 'step.write-rca',
				kind: 'step',
				field: 'core.stage',
				before: 'stage.review',
				after: 'stage.resolve',
				summary: 'Moved step Write the root cause analysis from stage Review to stage Resolve'
			},
			{
				type: 'node-changed',
				nodeId: 'step.write-rca',
				kind: 'step',
				field: 'core.actor',
				before: 'either',
				after: 'human',
				summary:
					'Changed who may do step Write the root cause analysis from people or agents to people only'
			}
		]);
	});

	it.each<[string, Operation[], string[]]>([
		[
			'a changed condition',
			[
				{
					op: 'update_core',
					id: 'step.form-working-group',
					changes: { when: { text: 'Only for SEV1 incidents', expr: "fact.severity == 'SEV1'" } }
				}
			],
			['Changed the condition on step Form the working group to "Only for SEV1 incidents"']
		],
		[
			'an added and a removed condition',
			[
				{ op: 'update_core', id: 'step.form-working-group', changes: { when: null } },
				{
					op: 'update_core',
					id: 'step.resolve-incident',
					changes: { when: { text: 'Once mitigated' } }
				}
			],
			[
				'Removed the condition from step Form the working group',
				'Added a condition to step Resolve the incident: "Once mitigated"'
			]
		],
		[
			'a rename, which later lines then use',
			[
				{ op: 'update_core', id: 'stage.detect', changes: { title: 'Triage' } },
				{ op: 'move_to_stage', id: 'step.resolve-incident', stage: 'stage.detect' }
			],
			[
				'Renamed stage Detect to Triage',
				'Moved step Resolve the incident from stage Resolve to stage Triage'
			]
		],
		[
			'required facts added and removed',
			[
				{ op: 'link', from: 'step.write-rca', edge: 'requires', to: 'fact.resolved-at' },
				{ op: 'unlink', from: 'step.write-rca', edge: 'requires', to: 'fact.severity' }
			],
			[
				'Step Write the root cause analysis now requires fact Resolved at and no longer requires fact Severity'
			]
		],
		[
			'a collected fact and who records it',
			[
				{ op: 'link', from: 'step.resolve-incident', edge: 'collects', to: 'fact.status-update' },
				{
					op: 'update_core',
					id: 'step.form-working-group',
					changes: { collects: [{ fact: 'fact.working-group' }] }
				}
			],
			[
				'Changed who records fact Working group in step Form the working group',
				'Step Resolve the incident now collects fact Latest status update'
			]
		],
		[
			'an approval removed',
			[{ op: 'unlink', from: 'step.write-rca', edge: 'approval', to: 'approval.rca-sign-off' }],
			['Step Write the root cause analysis no longer needs approval Sign off the RCA']
		],
		[
			'a changed role',
			[
				{
					op: 'update_core',
					id: 'decision.classify-severity',
					changes: { role: 'role.on-call-engineer' }
				}
			],
			[
				'Changed the role of decision Classify severity from role Incident commander to role On-call engineer'
			]
		],
		[
			'content added, changed and removed',
			[
				{ op: 'set_content', id: 'stage.detect', content: 'Spot it.' },
				{ op: 'set_content', id: 'step.report-incident', content: 'Open a channel.' },
				{ op: 'set_content', id: 'approval.rca-sign-off', content: null }
			],
			[
				'Added guidance to stage Detect',
				'Changed the guidance on step Report the incident',
				'Removed the guidance from approval Sign off the RCA'
			]
		],
		[
			'data keys set, changed and removed',
			[
				{ op: 'set_data', id: 'step.form-working-group', key: 'ui.icon', value: 'people' },
				{ op: 'set_data', id: 'step.form-working-group', key: 'bpmn.x', value: 120 },
				{ op: 'set_data', id: 'step.notify-downstream', key: 'hooks.on_completed', value: null }
			],
			[
				'Changed ui.icon on step Form the working group',
				'Set bpmn.x on step Form the working group',
				'Removed hooks.on_completed from step Notify downstream teams'
			]
		],
		[
			'a changed fact schema',
			[
				{
					op: 'update_core',
					id: 'fact.severity',
					changes: { schema: { enum: ['SEV1', 'SEV2', 'SEV3'] } }
				}
			],
			['Changed the value type of fact Severity']
		],
		[
			'a repeat removed',
			[{ op: 'update_core', id: 'step.post-status-update', changes: { repeat: null } }],
			['Step Post a status update no longer repeats']
		]
	])('summarises %s', (_name, ops, summary) => {
		expect(summaryOf(incidentManagement, ops)).toEqual(summary);
	});

	it('reports changed document fields first', () => {
		const next = { ...birthRegistrationAbroad, version: 4 };
		expect(diff(birthRegistrationAbroad, next)).toEqual([
			{
				type: 'document-changed',
				field: 'version',
				before: 3,
				after: 4,
				summary: 'Changed the version from 3 to 4'
			}
		]);
	});

	it('omits before for an added field and after for a removed one', () => {
		const [added] = diff(
			incidentManagement,
			edited(incidentManagement, [{ op: 'set_content', id: 'stage.detect', content: 'Spot it.' }])
		);
		expect(added).not.toHaveProperty('before');
		expect(added).toMatchObject({ field: 'content', after: 'Spot it.' });
		const [removed] = diff(
			incidentManagement,
			edited(incidentManagement, [
				{ op: 'set_data', id: 'step.form-working-group', key: 'ui.icon', value: null }
			])
		);
		expect(removed).not.toHaveProperty('after');
		expect(removed).toMatchObject({ field: 'data["ui.icon"]', before: 'users' });
	});
});
