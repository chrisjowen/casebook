import { brokenDocument, scaffold } from './shared.js';

/** A step requires a declared fact that no step or decision collects. */
export const uncollectedFact = brokenDocument('uncollected-fact', [
	...scaffold,
	{ core: { id: 'fact.invoice-number', kind: 'fact', schema: { type: 'string' } } },
	{ core: { id: 'fact.payment-date', kind: 'fact', schema: { type: 'string', format: 'date' } } },
	{
		core: {
			id: 'step.record-payment',
			kind: 'step',
			stage: 'stage.main',
			role: 'role.clerk',
			actor: 'either',
			requires: ['fact.invoice-number'],
			collects: [{ fact: 'fact.payment-date' }]
		}
	}
]);

/** Publishable, with warnings: facts read by assigns, evidence and a lookup that nothing collects. */
export const uncollectedReads = brokenDocument('uncollected-reads', [
	...scaffold,
	{ core: { id: 'role.responder', kind: 'role', scope: 'case' } },
	{ core: { id: 'fact.responders', kind: 'fact', schema: { type: 'array' } } },
	{ core: { id: 'fact.receipt', kind: 'fact', schema: { type: 'string' } } },
	{ core: { id: 'fact.region', kind: 'fact', schema: { type: 'string' } } },
	{
		core: {
			id: 'fact.office',
			kind: 'fact',
			schema: { type: 'string', 'x-lookup': { kind: 'fact', fact: 'fact.region' } }
		}
	},
	{
		core: {
			id: 'step.form-group',
			kind: 'step',
			stage: 'stage.main',
			role: 'role.clerk',
			actor: 'either',
			collects: [{ fact: 'fact.office' }],
			evidence: [{ description: 'Payment receipt', fact: 'fact.receipt' }],
			assigns: [{ role: 'role.responder', fact: 'fact.responders' }]
		}
	}
]);
