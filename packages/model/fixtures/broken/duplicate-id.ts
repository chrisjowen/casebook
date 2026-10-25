import { brokenDocument, scaffold } from './shared.js';

/** Two nodes share an id. */
export const duplicateId = brokenDocument('duplicate-id', [
	...scaffold,
	{ core: { id: 'fact.total', kind: 'fact', schema: { type: 'number' } } },
	{ core: { id: 'fact.total', kind: 'fact', schema: { type: 'integer' } } },
	{
		core: {
			id: 'step.sum',
			kind: 'step',
			stage: 'stage.main',
			role: 'role.clerk',
			actor: 'agent',
			collects: [{ fact: 'fact.total' }]
		}
	}
]);
