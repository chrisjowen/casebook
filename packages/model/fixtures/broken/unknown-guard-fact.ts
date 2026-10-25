import { brokenDocument, scaffold } from './shared.js';

/** A guard expression that reads a fact the definition never declares. */
export const unknownGuardFact = brokenDocument('unknown-guard-fact', [
	...scaffold,
	{ core: { id: 'fact.amount', kind: 'fact', schema: { type: 'number' } } },
	{
		core: {
			id: 'step.enter-amount',
			kind: 'step',
			stage: 'stage.main',
			role: 'role.clerk',
			actor: 'either',
			collects: [{ fact: 'fact.amount' }]
		}
	},
	{
		core: {
			id: 'step.escalate',
			kind: 'step',
			stage: 'stage.main',
			role: 'role.clerk',
			actor: 'human',
			requires: ['fact.amount'],
			when: {
				text: 'When the amount exceeds the approval limit',
				expr: "fact.amount > fact.approval-limit && fact.currency == 'fact.not-a-reference'"
			}
		}
	}
]);
