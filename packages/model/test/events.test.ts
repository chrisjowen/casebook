import { describe, expect, it } from 'vitest';
import { isLifecycleEvent, LIFECYCLE_EVENTS } from '../src/index.js';

describe('lifecycle events', () => {
	it('reserves the names from ADR 0010', () => {
		expect(LIFECYCLE_EVENTS).toEqual(
			expect.arrayContaining(['case.opened', 'fact.recorded', 'step.completed', 'decision.made'])
		);
	});

	it('names every event as subject.past-tense-verb', () => {
		for (const event of LIFECYCLE_EVENTS) {
			expect(event).toMatch(/^[a-z]+\.[a-z]+$/);
		}
	});

	it('recognises reserved names', () => {
		expect(isLifecycleEvent('step.completed')).toBe(true);
		expect(isLifecycleEvent('step.finished')).toBe(false);
	});
});
