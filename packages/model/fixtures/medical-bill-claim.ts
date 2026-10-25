import type { DefinitionDocument } from '../src/index.js';

/** Synthetic: claim a medical bill back from a health insurer. */
export const medicalBillClaim: DefinitionDocument = {
	schemaVersion: 1,
	namespace: 'personal/example-user/family',
	slug: 'medical-bill-claim',
	version: 1,
	nodes: [
		{
			core: { id: 'process.medical-bill-claim', kind: 'process', title: 'Claim a medical bill' },
			content:
				'Get an itemised bill from the care provider, claim it, and record what was paid back.'
		},
		{ core: { id: 'stage.collect-bill', kind: 'stage', title: 'Collect the bill' } },
		{ core: { id: 'stage.submit-claim', kind: 'stage', title: 'Submit the claim' } },
		{ core: { id: 'stage.insurer-review', kind: 'stage', title: 'Insurer review' } },
		{ core: { id: 'stage.reimbursement', kind: 'stage', title: 'Reimbursement' } },

		{ core: { id: 'role.claimant', kind: 'role', title: 'Claimant', scope: 'case' } },
		{ core: { id: 'role.care-provider', kind: 'role', title: 'Care provider', scope: 'case' } },
		{ core: { id: 'role.insurer', kind: 'role', title: 'Insurer', scope: 'namespace' } },

		{
			core: {
				id: 'fact.patient-name',
				kind: 'fact',
				title: 'Patient name',
				schema: { type: 'string', minLength: 1, 'x-sensitivity': 'personal' }
			}
		},
		{
			core: {
				id: 'fact.date-of-service',
				kind: 'fact',
				title: 'Date of treatment',
				schema: { type: 'string', format: 'date' }
			}
		},
		{
			core: {
				id: 'fact.provider-name',
				kind: 'fact',
				title: 'Care provider',
				schema: { type: 'string', minLength: 1 }
			}
		},
		{
			core: {
				id: 'fact.provider-contact',
				kind: 'fact',
				title: 'Who sends the bill',
				schema: {
					type: 'array',
					minItems: 1,
					items: { type: 'string', description: 'Principal id' },
					'x-lookup': { kind: 'principal' }
				}
			},
			content: 'The person at the care provider who sends the itemised bill.'
		},
		{
			core: {
				id: 'fact.itemised-invoice',
				kind: 'fact',
				title: 'Itemised invoice',
				schema: {
					type: 'string',
					format: 'uri',
					'x-evidence': {
						description: 'Itemised invoice on the provider’s letterhead',
						formats: ['pdf'],
						copies: 1
					}
				}
			}
		},
		{
			core: {
				id: 'fact.amount-billed',
				kind: 'fact',
				title: 'Amount billed',
				schema: { type: 'number', minimum: 0, examples: [1840], 'x-currency': 'EUR' }
			}
		},
		{
			core: {
				id: 'fact.payment-receipt',
				kind: 'fact',
				title: 'Proof of payment',
				schema: {
					type: 'string',
					format: 'uri',
					'x-evidence': { description: 'Receipt or bank statement line', formats: ['pdf', 'scan'] }
				}
			}
		},
		{
			core: {
				id: 'fact.claim-reference',
				kind: 'fact',
				title: 'Claim reference',
				schema: { type: 'string', pattern: '^CL-[0-9]{5}$', examples: ['CL-10422'] }
			}
		},
		{
			core: {
				id: 'fact.insurer-decision',
				kind: 'fact',
				title: 'Insurer decision',
				schema: { type: 'string', enum: ['approved', 'partly approved', 'declined'] }
			}
		},
		{
			core: {
				id: 'fact.amount-reimbursed',
				kind: 'fact',
				title: 'Amount reimbursed',
				schema: { type: 'number', minimum: 0, 'x-currency': 'EUR' }
			}
		},

		{
			core: {
				id: 'step.request-invoice',
				kind: 'step',
				title: 'Ask the provider for an itemised bill',
				stage: 'stage.collect-bill',
				role: 'role.claimant',
				actor: 'either',
				collects: [
					{ fact: 'fact.patient-name' },
					{ fact: 'fact.date-of-service' },
					{ fact: 'fact.provider-name' },
					{ fact: 'fact.provider-contact' }
				],
				assigns: [{ role: 'role.care-provider', fact: 'fact.provider-contact' }]
			},
			content: 'Insurers only accept itemised bills, not the summary handed over at discharge.'
		},
		{
			core: {
				id: 'step.provide-invoice',
				kind: 'step',
				title: 'Send the itemised invoice',
				stage: 'stage.collect-bill',
				role: 'role.care-provider',
				actor: 'human',
				requires: ['fact.patient-name', 'fact.date-of-service'],
				collects: [{ fact: 'fact.itemised-invoice' }, { fact: 'fact.amount-billed' }],
				evidence: [
					{
						description: 'Itemised invoice on the provider’s letterhead',
						formats: ['pdf'],
						fact: 'fact.itemised-invoice'
					}
				]
			},
			content: 'List each treatment line with its billing code and price.'
		},
		{
			core: {
				id: 'step.submit-claim',
				kind: 'step',
				title: 'Submit the claim',
				stage: 'stage.submit-claim',
				role: 'role.claimant',
				actor: 'either',
				requires: ['fact.itemised-invoice', 'fact.amount-billed', 'fact.patient-name'],
				collects: [{ fact: 'fact.payment-receipt' }, { fact: 'fact.claim-reference' }]
			},
			content: 'An agent may fill in the insurer’s form from the recorded facts.'
		},
		{
			core: {
				id: 'decision.assess-claim',
				kind: 'decision',
				title: 'Assess the claim',
				stage: 'stage.insurer-review',
				role: 'role.insurer',
				actor: 'either',
				requires: ['fact.claim-reference', 'fact.itemised-invoice'],
				outcome: 'fact.insurer-decision'
			}
		},
		{
			core: {
				id: 'step.record-reimbursement',
				kind: 'step',
				title: 'Record the reimbursement',
				stage: 'stage.reimbursement',
				role: 'role.claimant',
				actor: 'either',
				requires: ['fact.insurer-decision'],
				collects: [{ fact: 'fact.amount-reimbursed' }],
				when: {
					text: 'Unless the claim was declined',
					expr: "fact.insurer-decision != 'declined'"
				}
			}
		}
	]
};
