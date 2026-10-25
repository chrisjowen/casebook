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
