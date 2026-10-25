import { brokenDocument } from './shared.js';

/** A definition with no process node. */
export const missingProcess = brokenDocument('missing-process', [
	{ core: { id: 'stage.main', kind: 'stage' } },
	{ core: { id: 'role.clerk', kind: 'role' } },
	{ core: { id: 'fact.note', kind: 'fact', schema: { type: 'string' } } },
	{
		core: {
			id: 'step.take-note',
			kind: 'step',
			stage: 'stage.main',
			role: 'role.clerk',
			actor: 'either',
			collects: [{ fact: 'fact.note' }]
		}
	}
]);

/** A definition with two process nodes. */
export const multipleProcesses = brokenDocument('multiple-processes', [
	{ core: { id: 'process.first', kind: 'process' } },
	{ core: { id: 'process.second', kind: 'process' } },
	{ core: { id: 'stage.main', kind: 'stage' } },
	{ core: { id: 'role.clerk', kind: 'role' } },
	{ core: { id: 'fact.note', kind: 'fact', schema: { type: 'string' } } },
	{
		core: {
			id: 'step.take-note',
			kind: 'step',
			stage: 'stage.main',
			role: 'role.clerk',
			actor: 'either',
			collects: [{ fact: 'fact.note' }]
		}
	}
]);
