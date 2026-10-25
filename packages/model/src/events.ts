/**
 * Lifecycle event names reserved for hooks (ADR 0010). Nodes may bind hooks to these in
 * `data.hooks.*`; nothing executes them in v1, but the event log is shaped around these names.
 */
export const LIFECYCLE_EVENTS = [
	'case.opened',
	'case.closed',
	'process.started',
	'process.completed',
	'stage.entered',
	'stage.completed',
	'step.started',
	'step.completed',
	'step.skipped',
	'fact.recorded',
	'evidence.attached',
	'decision.made',
	'approval.requested',
	'approval.granted',
	'approval.rejected',
	'role.assigned'
] as const;

export type LifecycleEvent = (typeof LIFECYCLE_EVENTS)[number];

const lifecycleEvents: ReadonlySet<string> = new Set(LIFECYCLE_EVENTS);

export function isLifecycleEvent(name: string): name is LifecycleEvent {
	return lifecycleEvents.has(name);
}
