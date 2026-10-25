import { brokenDocument, scaffold } from './shared.js';

/** A step whose stage, collected fact and approval do not exist. */
export const unresolvedReferences = brokenDocument('unresolved-references', [
	...scaffold,
	{
		core: {
			id: 'step.file-report',
			kind: 'step',
			stage: 'stage.archive',
			role: 'role.clerk',
			actor: 'either',
			collects: [{ fact: 'fact.report' }],
			approval: 'approval.manager-sign-off'
		}
	}
]);
