import { describe, expect, it } from 'vitest';
import {
	durationMs,
	evaluateProcess,
	foldProgress,
	runnableProcess,
	type ItemEvent,
	type ItemState
} from '../../src/index.js';
import { birthRegistrationAbroad, incidentManagement } from '../../fixtures/index.js';

const now = new Date('2026-10-25T12:00:00Z');
const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000).toISOString();

function run(
	document: typeof incidentManagement,
	facts: Record<string, unknown>,
	events: Omit<ItemEvent, 'at'>[] = []
) {
	const process = runnableProcess(document);
	const progress = foldProgress(
		process,
		events.map((e, i) => ({ ...e, at: at(events.length - i) }))
	);
	const state = evaluateProcess(process, facts, progress, now);
	const item = (id: string) => state.items.find((i) => i.item.id === id) as ItemState;
	return { state, item };
}

describe('runnableProcess', () => {
	it('places each approval right after the step it reviews, in that step’s stage', () => {
		const { items } = runnableProcess(incidentManagement);
		const ids = items.map((i) => i.id);
		expect(ids.indexOf('approval.rca-sign-off')).toBe(ids.indexOf('step.write-rca') + 1);
		const approval = items.find((i) => i.id === 'approval.rca-sign-off')!;
		expect(approval).toMatchObject({ stage: 'stage.review', reviews: 'step.write-rca' });
	});

	it('records a decision’s outcome as what it collects', () => {
		const decision = runnableProcess(incidentManagement).items.find(
			(i) => i.id === 'decision.classify-severity'
		);
		expect(decision?.collects).toEqual([{ fact: 'fact.severity' }]);
	});
});

describe('evaluateProcess', () => {
	it('starts in the first stage with the first step ready', () => {
		const { state, item } = run(incidentManagement, {});
		expect(state.current).toBe(0);
		expect(state.stages.map((s) => s.state)).toEqual([
			'current',
			'upcoming',
			'upcoming',
			'upcoming'
		]);
		expect(item('step.report-incident').status).toBe('ready');
		expect(item('decision.classify-severity')).toMatchObject({
			status: 'waiting',
			waitingOn: 'step.report-incident',
			missing: ['fact.incident-summary', 'fact.affected-services']
		});
		expect(item('step.resolve-incident').status).toBe('upcoming');
	});

	it('moves to the next stage once a stage’s items are settled, skipping by guard', () => {
		const facts = {
			'fact.incident-summary': 'x',
			'fact.affected-services': ['api'],
			'fact.severity': 'SEV3'
		};
		const { state, item } = run(incidentManagement, facts, [
			{ type: 'step.completed', item: 'step.report-incident', by: 'lee' },
			{ type: 'decision.made', item: 'decision.classify-severity', by: 'priya' }
		]);
		// SEV3 needs no working group, and the repeating status update never holds a stage open.
		expect(item('step.form-working-group').status).toBe('skipped');
		expect(state.current).toBe(2);
		expect(item('step.resolve-incident').status).toBe('ready');
		expect(item('step.post-status-update')).toMatchObject({ status: 'ready', overdue: true });
	});

	it('works out when a repeating step is due, and settles it by its until condition', () => {
		const facts = { 'fact.severity': 'SEV2' };
		const events: Omit<ItemEvent, 'at'>[] = [
			{ type: 'step.completed', item: 'step.post-status-update', by: 'alex' }
		];
		const due = run(incidentManagement, facts, events).item('step.post-status-update');
		expect(due).toMatchObject({ status: 'upcoming' });
		const later = run(incidentManagement, { ...facts, 'fact.resolved-at': 'x' }, events);
		expect(later.item('step.post-status-update').status).toBe('done');
	});

	it('keeps an approval upcoming until its step is done, then sends the step back on rejection', () => {
		const facts = {
			'fact.incident-summary': 'x',
			'fact.affected-services': ['api'],
			'fact.severity': 'SEV3',
			'fact.resolution-summary': 'y',
			'fact.resolved-at': 'z'
		};
		const before: Omit<ItemEvent, 'at'>[] = [
			{ type: 'step.completed', item: 'step.report-incident', by: 'lee' },
			{ type: 'decision.made', item: 'decision.classify-severity', by: 'priya' },
			{ type: 'step.completed', item: 'step.resolve-incident', by: 'priya' }
		];
		const review = run(incidentManagement, facts, before);
		expect(review.state.current).toBe(3);
		expect(review.item('approval.rca-sign-off').status).toBe('upcoming');
		// The RCA guard is prose only, so its role decides by doing or skipping it.
		expect(review.item('step.write-rca')).toMatchObject({ status: 'ready', guard: 'open' });

		const written = [
			...before,
			{ type: 'step.completed', item: 'step.write-rca', by: 'priya' } as const
		];
		const withRca = { ...facts, 'fact.rca-document': 'casebook:file/x' };
		expect(run(incidentManagement, withRca, written).item('approval.rca-sign-off').status).toBe(
			'ready'
		);

		const rejected = run(incidentManagement, withRca, [
			...written,
			{
				type: 'approval.rejected',
				item: 'approval.rca-sign-off',
				by: 'jordan',
				data: { note: 'Add a timeline' }
			}
		]);
		expect(rejected.item('step.write-rca')).toMatchObject({
			status: 'ready',
			progress: { sentBack: { by: 'jordan', note: 'Add a timeline' } }
		});
		expect(rejected.item('approval.rca-sign-off').status).toBe('upcoming');
	});

	it('skips an approval with its skipped step, and finishes the process', () => {
		const facts = {
			'fact.incident-summary': 'x',
			'fact.affected-services': ['api'],
			'fact.severity': 'SEV4',
			'fact.resolution-summary': 'y',
			'fact.resolved-at': 'z',
			'fact.downstream-notified': true
		};
		const { state, item } = run(incidentManagement, facts, [
			{ type: 'step.completed', item: 'step.report-incident', by: 'lee' },
			{ type: 'decision.made', item: 'decision.classify-severity', by: 'priya' },
			{ type: 'step.completed', item: 'step.resolve-incident', by: 'priya' },
			{ type: 'step.skipped', item: 'step.write-rca', by: 'priya', data: { reason: 'Cosmetic' } },
			{ type: 'step.completed', item: 'step.notify-downstream', by: 'agent' }
		]);
		expect(item('approval.rca-sign-off').status).toBe('skipped');
		expect(state).toMatchObject({ complete: true, current: 4 });
	});

	it('holds a paused item until it is resumed or completed', () => {
		const held = run(birthRegistrationAbroad, {}, [
			{
				type: 'step.held',
				item: 'step.register-locally',
				by: 'alex',
				data: { note: 'At the registry' }
			}
		]);
		expect(held.item('step.register-locally')).toMatchObject({
			status: 'held',
			progress: { held: { note: 'At the registry' } }
		});
		const resumed = run(birthRegistrationAbroad, {}, [
			{ type: 'step.held', item: 'step.register-locally', by: 'alex', data: { note: 'x' } },
			{ type: 'step.resumed', item: 'step.register-locally', by: 'alex' }
		]);
		expect(resumed.item('step.register-locally').status).toBe('ready');
	});

	it('waits on a guard’s facts, then skips the guarded step when it does not apply', () => {
		const registered = {
			'fact.child-name': 'Mira',
			'fact.date-of-birth': '2026-09-12',
			'fact.country-of-birth': 'PT',
			'fact.local-birth-certificate': 'BC-1'
		};
		const events: Omit<ItemEvent, 'at'>[] = [
			{ type: 'step.completed', item: 'step.register-locally', by: 'alex' },
			{ type: 'step.started', item: 'step.complete-application', by: 'sam' },
			{ type: 'step.started', item: 'step.complete-application', by: 'sam' }
		];
		const pending = run(birthRegistrationAbroad, registered, events);
		expect(pending.item('step.translate-certificate')).toMatchObject({
			status: 'waiting',
			guard: 'pending',
			waitingOn: 'decision.translation-required'
		});
		expect(pending.item('step.complete-application').progress.started).toEqual([
			{ by: 'sam', at: expect.any(String) }
		]);
		const decided = run(
			birthRegistrationAbroad,
			{ ...registered, 'fact.translation-required': false },
			[...events, { type: 'decision.made', item: 'decision.translation-required', by: 'sam' }]
		);
		expect(decided.item('step.translate-certificate').status).toBe('skipped');
	});
});

describe('durationMs', () => {
	it('reads ISO 8601 durations', () => {
		expect(durationMs('PT30M')).toBe(30 * 60_000);
		expect(durationMs('P1DT2H')).toBe(26 * 3_600_000);
		expect(durationMs('soon')).toBeUndefined();
		expect(durationMs('PT')).toBeUndefined();
	});
});
