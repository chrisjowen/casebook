import { brokenDocument, scaffold } from './shared.js';

/** Publishable, but with warnings: an unused fact, an empty stage and a guard on an uncollected fact. */
export const unusedNodes = brokenDocument('unused-nodes', [
	...scaffold,
	{ core: { id: 'stage.later', kind: 'stage' } },
	{ core: { id: 'fact.orphan', kind: 'fact', schema: { type: 'string' } } },
	{ core: { id: 'fact.priority', kind: 'fact', schema: { type: 'string' } } },
	{ core: { id: 'fact.note', kind: 'fact', schema: { type: 'string' } } },
	{
		core: {
			id: 'step.take-note',
			kind: 'step',
			stage: 'stage.main',
			role: 'role.clerk',
			actor: 'either',
			collects: [{ fact: 'fact.note' }],
			when: { text: 'For urgent cases', expr: "fact.priority == 'urgent'" }
		}
	}
]);
