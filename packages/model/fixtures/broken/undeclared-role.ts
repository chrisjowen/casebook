import { brokenDocument, scaffold } from './shared.js';

/** Roles named by a step, a collected fact, a lookup and a guard that are never declared. */
export const undeclaredRole = brokenDocument('undeclared-role', [
	...scaffold,
	{
		core: {
			id: 'fact.reviewer',
			kind: 'fact',
			schema: { type: 'string', 'x-lookup': { kind: 'principal', role: 'role.reviewer' } }
		}
	},
	{
		core: {
			id: 'step.assign-reviewer',
			kind: 'step',
			stage: 'stage.main',
			role: 'role.manager',
			actor: 'human',
			collects: [{ fact: 'fact.reviewer', by: 'role.supervisor' }],
			when: {
				text: 'Unless an auditor is already on the case',
				expr: '!(role.auditor in case.roles)'
			}
		}
	}
]);
