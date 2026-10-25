import { brokenDocument, scaffold } from './shared.js';

/** Two steps that each require the fact the other collects, so neither can start. */
export const dependencyCycle = brokenDocument('dependency-cycle', [
	...scaffold,
	{ core: { id: 'fact.quote', kind: 'fact', schema: { type: 'number' } } },
	{ core: { id: 'fact.order', kind: 'fact', schema: { type: 'string' } } },
	{
		core: {
			id: 'step.prepare-quote',
			kind: 'step',
			stage: 'stage.main',
			role: 'role.clerk',
			actor: 'either',
			requires: ['fact.order'],
			collects: [{ fact: 'fact.quote' }]
		}
	},
	{
		core: {
			id: 'step.place-order',
			kind: 'step',
			stage: 'stage.main',
			role: 'role.clerk',
			actor: 'either',
			requires: ['fact.quote'],
			collects: [{ fact: 'fact.order' }]
		}
	}
]);

/** A step that requires the fact it collects itself. */
export const selfDependency = brokenDocument('self-dependency', [
	...scaffold,
	{ core: { id: 'fact.signature', kind: 'fact', schema: { type: 'string' } } },
	{
		core: {
			id: 'step.sign',
			kind: 'step',
			stage: 'stage.main',
			role: 'role.clerk',
			actor: 'human',
			requires: ['fact.signature'],
			collects: [{ fact: 'fact.signature' }]
		}
	}
]);

/** Publishable: a step re-collects a fact it requires, which an earlier step also collects. */
export const recollectedFact = brokenDocument('recollected-fact', [
	...scaffold,
	{ core: { id: 'fact.severity', kind: 'fact', schema: { type: 'string' } } },
	{
		core: {
			id: 'step.triage',
			kind: 'step',
			stage: 'stage.main',
			role: 'role.clerk',
			actor: 'either',
			collects: [{ fact: 'fact.severity' }]
		}
	},
	{
		core: {
			id: 'step.update-severity',
			kind: 'step',
			stage: 'stage.main',
			role: 'role.clerk',
			actor: 'either',
			requires: ['fact.severity'],
			collects: [{ fact: 'fact.severity' }]
		}
	}
]);

/**
 * Publishable: step.quote and step.order look like a cycle, but step.import also collects
 * fact.order, so step.quote can start after it.
 */
export const alternativeCollector = brokenDocument('alternative-collector', [
	...scaffold,
	{ core: { id: 'fact.quote', kind: 'fact', schema: { type: 'number' } } },
	{ core: { id: 'fact.order', kind: 'fact', schema: { type: 'string' } } },
	{
		core: {
			id: 'step.quote',
			kind: 'step',
			stage: 'stage.main',
			role: 'role.clerk',
			actor: 'either',
			requires: ['fact.order'],
			collects: [{ fact: 'fact.quote' }]
		}
	},
	{
		core: {
			id: 'step.import',
			kind: 'step',
			stage: 'stage.main',
			role: 'role.clerk',
			actor: 'agent',
			collects: [{ fact: 'fact.order' }]
		}
	},
	{
		core: {
			id: 'step.order',
			kind: 'step',
			stage: 'stage.main',
			role: 'role.clerk',
			actor: 'either',
			requires: ['fact.quote'],
			collects: [{ fact: 'fact.order' }]
		}
	}
]);
