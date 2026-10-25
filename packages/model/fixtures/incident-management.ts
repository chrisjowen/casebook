import type { DefinitionDocument } from '../src/index.js';

/**
 * Synthetic incident-management process: classify severity, form a working group for major
 * incidents, post repeating status updates, resolve, write an RCA with human-only sign-off, and
 * notify downstream teams.
 */
export const incidentManagement: DefinitionDocument = {
	schemaVersion: 1,
	namespace: 'acme/eng/sre',
	slug: 'incident-management',
	version: 1,
	nodes: [
		{
			core: { id: 'process.incident-management', kind: 'process', title: 'Incident management' },
			content: 'From first report to a signed-off root cause analysis.'
		},

		{ core: { id: 'stage.detect', kind: 'stage', title: 'Detect' } },
		{ core: { id: 'stage.respond', kind: 'stage', title: 'Respond' } },
		{ core: { id: 'stage.resolve', kind: 'stage', title: 'Resolve' } },
		{ core: { id: 'stage.review', kind: 'stage', title: 'Review' } },

		{
			core: {
				id: 'role.on-call-engineer',
				kind: 'role',
				title: 'On-call engineer',
				scope: 'namespace'
			}
		},
		{
			core: {
				id: 'role.incident-commander',
				kind: 'role',
				title: 'Incident commander',
				scope: 'namespace'
			}
		},
		{
			core: {
				id: 'role.communications-lead',
				kind: 'role',
				title: 'Communications lead',
				scope: 'namespace'
			}
		},
		{
			core: { id: 'role.service-owner', kind: 'role', title: 'Service owner', scope: 'namespace' }
		},
		{
			core: {
				id: 'role.working-group-member',
				kind: 'role',
				title: 'Working group member',
				scope: 'case'
			},
			content: 'Assigned per incident when the working group is formed.'
		},
		{
			core: {
				id: 'role.engineering-director',
				kind: 'role',
				title: 'Engineering director',
				scope: 'namespace'
			}
		},

		{
			core: {
				id: 'fact.incident-summary',
				kind: 'fact',
				title: 'Incident summary',
				schema: { type: 'string', minLength: 1, 'x-sensitivity': 'none' }
			}
		},
		{
			core: {
				id: 'fact.affected-services',
				kind: 'fact',
				title: 'Affected services',
				schema: {
					type: 'array',
					minItems: 1,
					items: { type: 'string' },
					'x-lookup': { kind: 'dataset', dataset: 'service-catalog', version: '2026-10' }
				}
			}
		},
		{
			core: {
				id: 'fact.severity',
				kind: 'fact',
				title: 'Severity',
				schema: { type: 'string', enum: ['SEV1', 'SEV2', 'SEV3', 'SEV4'] }
			},
			content: 'SEV1 is a full outage of a customer-facing service; SEV4 is cosmetic.'
		},
		{
			core: {
				id: 'fact.working-group',
				kind: 'fact',
				title: 'Working group',
				schema: {
					type: 'array',
					items: { type: 'string', description: 'Principal id' },
					'x-lookup': { kind: 'principal', role: 'role.service-owner' }
				}
			}
		},
		{
			core: {
				id: 'fact.status-update',
				kind: 'fact',
				title: 'Latest status update',
				schema: { type: 'string', minLength: 1 }
			}
		},
		{
			core: {
				id: 'fact.resolution-summary',
				kind: 'fact',
				title: 'Resolution summary',
				schema: { type: 'string', minLength: 1 }
			}
		},
		{
			core: {
				id: 'fact.resolved-at',
				kind: 'fact',
				title: 'Resolved at',
				schema: { type: 'string', format: 'date-time' }
			}
		},
		{
			core: {
				id: 'fact.rca-document',
				kind: 'fact',
				title: 'Root cause analysis',
				schema: {
					type: 'string',
					format: 'uri',
					'x-evidence': {
						description: 'The written root cause analysis',
						formats: ['pdf', 'markdown'],
						copies: 1
					},
					'x-sensitivity': 'none'
				}
			}
		},
		{
			core: {
				id: 'fact.downstream-notified',
				kind: 'fact',
				title: 'Downstream teams notified',
				schema: { type: 'boolean' }
			}
		},

		{
			core: {
				id: 'step.report-incident',
				kind: 'step',
				title: 'Report the incident',
				stage: 'stage.detect',
				role: 'role.on-call-engineer',
				actor: 'either',
				collects: [{ fact: 'fact.incident-summary' }, { fact: 'fact.affected-services' }],
				source: { doc: 'incident-runbook.md', ref: '#reporting', inferred: false }
			},
			content: 'Open the incident channel and summarise what is broken and for whom.'
		},
		{
			core: {
				id: 'decision.classify-severity',
				kind: 'decision',
				title: 'Classify severity',
				stage: 'stage.detect',
				role: 'role.incident-commander',
				actor: 'either',
				requires: ['fact.incident-summary', 'fact.affected-services'],
				outcome: 'fact.severity',
				source: { doc: 'incident-runbook.md', ref: '#severity', inferred: false }
			}
		},
		{
			core: {
				id: 'step.form-working-group',
				kind: 'step',
				title: 'Form the working group',
				stage: 'stage.respond',
				role: 'role.incident-commander',
				actor: 'either',
				requires: ['fact.severity', 'fact.affected-services'],
				collects: [{ fact: 'fact.working-group', by: 'role.incident-commander' }],
				assigns: [{ role: 'role.working-group-member', fact: 'fact.working-group' }],
				when: {
					text: 'Only for SEV1 or SEV2 incidents',
					expr: "fact.severity in ['SEV1', 'SEV2']"
				},
				source: { doc: 'incident-runbook.md', ref: '#working-group', inferred: false }
			},
			content:
				'Invite an owner from each affected service. Post the bridge link in the incident channel.',
			data: { 'ui.icon': 'users', 'hooks.on_completed': ['notify-status-page'] }
		},
		{
			core: {
				id: 'step.post-status-update',
				kind: 'step',
				title: 'Post a status update',
				stage: 'stage.respond',
				role: 'role.communications-lead',
				actor: 'either',
				requires: ['fact.severity'],
				collects: [{ fact: 'fact.status-update' }],
				repeat: {
					until: { text: 'Until the incident is resolved', expr: 'fact.resolved-at != null' },
					every: 'PT30M'
				},
				source: { doc: 'incident-runbook.md', ref: '#comms', inferred: true }
			}
		},
		{
			core: {
				id: 'step.resolve-incident',
				kind: 'step',
				title: 'Resolve the incident',
				stage: 'stage.resolve',
				role: 'role.incident-commander',
				actor: 'human',
				requires: ['fact.severity'],
				collects: [{ fact: 'fact.resolution-summary' }, { fact: 'fact.resolved-at' }]
			}
		},
		{
			core: {
				id: 'step.write-rca',
				kind: 'step',
				title: 'Write the root cause analysis',
				stage: 'stage.review',
				role: 'role.incident-commander',
				actor: 'either',
				requires: ['fact.severity', 'fact.resolution-summary'],
				collects: [{ fact: 'fact.rca-document' }],
				evidence: [
					{
						description: 'The RCA document, linked from the incident',
						formats: ['pdf', 'markdown'],
						copies: 1,
						fact: 'fact.rca-document'
					}
				],
				when: {
					text: 'Always for SEV1 and SEV2; for lower severities at the commander’s discretion'
				},
				approval: 'approval.rca-sign-off'
			}
		},
		{
			core: {
				id: 'approval.rca-sign-off',
				kind: 'approval',
				title: 'Sign off the RCA',
				role: 'role.engineering-director',
				actor: 'human',
				requires: ['fact.rca-document']
			},
			content: 'An agent may draft the RCA, but only a person can sign it off.'
		},
		{
			core: {
				id: 'step.notify-downstream',
				kind: 'step',
				title: 'Notify downstream teams',
				stage: 'stage.review',
				role: 'role.communications-lead',
				actor: 'agent',
				requires: ['fact.affected-services', 'fact.resolution-summary'],
				collects: [{ fact: 'fact.downstream-notified' }]
			},
			data: { 'hooks.on_completed': ['post-to-status-page'] }
		}
	]
};
