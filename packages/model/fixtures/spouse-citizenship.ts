import type { DefinitionDocument } from '../src/index.js';

/** Synthetic: apply for citizenship through marriage to a citizen. */
export const spouseCitizenship: DefinitionDocument = {
	schemaVersion: 1,
	namespace: 'personal/example-user/family',
	slug: 'spouse-citizenship',
	version: 1,
	nodes: [
		{
			core: { id: 'process.spouse-citizenship', kind: 'process', title: 'Spouse citizenship' },
			content: 'Apply for citizenship as the spouse of a citizen.'
		},
		{ core: { id: 'stage.eligibility', kind: 'stage', title: 'Check eligibility' } },
		{ core: { id: 'stage.gather-documents', kind: 'stage', title: 'Gather documents' } },
		{ core: { id: 'stage.apply', kind: 'stage', title: 'Apply' } },
		{ core: { id: 'stage.decision', kind: 'stage', title: 'Decision' } },

		{ core: { id: 'role.applicant', kind: 'role', title: 'Applicant', scope: 'case' } },
		{ core: { id: 'role.sponsor', kind: 'role', title: 'Citizen spouse', scope: 'case' } },
		{ core: { id: 'role.caseworker', kind: 'role', title: 'Caseworker', scope: 'namespace' } },

		{
			core: {
				id: 'fact.marriage-date',
				kind: 'fact',
				title: 'Date of marriage',
				schema: { type: 'string', format: 'date' }
			}
		},
		{
			core: {
				id: 'fact.years-married',
				kind: 'fact',
				title: 'Years married',
				schema: { type: 'number', minimum: 0 }
			}
		},
		{
			core: {
				id: 'fact.eligible',
				kind: 'fact',
				title: 'Eligible to apply',
				schema: { type: 'boolean' }
			}
		},
		{
			core: {
				id: 'fact.marriage-certificate',
				kind: 'fact',
				title: 'Marriage certificate',
				schema: {
					type: 'string',
					format: 'uri',
					'x-evidence': {
						description: 'Marriage certificate with an apostille',
						formats: ['certified-copy'],
						copies: 1
					}
				}
			}
		},
		{
			core: {
				id: 'fact.citizenship-proof',
				kind: 'fact',
				title: 'Proof of the spouse’s citizenship',
				schema: {
					type: 'string',
					format: 'uri',
					'x-evidence': { description: 'Passport photo page', formats: ['scan'] }
				}
			}
		},
		{
			core: {
				id: 'fact.language-certificate',
				kind: 'fact',
				title: 'Language certificate',
				schema: {
					type: 'string',
					format: 'uri',
					'x-evidence': { description: 'B1 language certificate', formats: ['pdf'] }
				}
			}
		},
		{
			core: {
				id: 'fact.application-reference',
				kind: 'fact',
				title: 'Application reference',
				schema: { type: 'string', pattern: '^NAT-[0-9]{6}$' }
			}
		},
		{
			core: {
				id: 'fact.citizenship-decision',
				kind: 'fact',
				title: 'Decision',
				schema: { type: 'string', enum: ['granted', 'refused'] }
			}
		},

		{
			core: {
				id: 'step.record-marriage',
				kind: 'step',
				title: 'Record the marriage details',
				stage: 'stage.eligibility',
				role: 'role.sponsor',
				actor: 'either',
				collects: [{ fact: 'fact.marriage-date' }, { fact: 'fact.years-married' }]
			}
		},
		{
			core: {
				id: 'decision.check-eligibility',
				kind: 'decision',
				title: 'Check eligibility',
				stage: 'stage.eligibility',
				role: 'role.applicant',
				actor: 'either',
				requires: ['fact.years-married'],
				outcome: 'fact.eligible'
			},
			content: 'Spouses can apply after three years of marriage.'
		},
		{
			core: {
				id: 'step.provide-marriage-certificate',
				kind: 'step',
				title: 'Upload the marriage certificate',
				stage: 'stage.gather-documents',
				role: 'role.sponsor',
				actor: 'human',
				requires: ['fact.marriage-date'],
				collects: [{ fact: 'fact.marriage-certificate' }],
				evidence: [
					{
						description: 'Certified copy with an apostille from the issuing country',
						formats: ['certified-copy'],
						fact: 'fact.marriage-certificate'
					}
				]
			}
		},
		{
			core: {
				id: 'step.provide-citizenship-proof',
				kind: 'step',
				title: 'Upload proof of citizenship',
				stage: 'stage.gather-documents',
				role: 'role.sponsor',
				actor: 'human',
				collects: [{ fact: 'fact.citizenship-proof' }]
			}
		},
		{
			core: {
				id: 'step.provide-language-certificate',
				kind: 'step',
				title: 'Upload the language certificate',
				stage: 'stage.gather-documents',
				role: 'role.applicant',
				actor: 'human',
				collects: [{ fact: 'fact.language-certificate' }]
			}
		},
		{
			core: {
				id: 'step.submit-application',
				kind: 'step',
				title: 'Submit the application',
				stage: 'stage.apply',
				role: 'role.applicant',
				actor: 'either',
				requires: [
					'fact.eligible',
					'fact.marriage-certificate',
					'fact.citizenship-proof',
					'fact.language-certificate'
				],
				collects: [{ fact: 'fact.application-reference' }]
			}
		},
		{
			core: {
				id: 'decision.decide-application',
				kind: 'decision',
				title: 'Decide the application',
				stage: 'stage.decision',
				role: 'role.caseworker',
				actor: 'human',
				requires: ['fact.application-reference'],
				outcome: 'fact.citizenship-decision'
			}
		}
	]
};
