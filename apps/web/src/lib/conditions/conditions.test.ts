import { describe, expect, it } from 'vitest';
import { incidentManagement } from '@casebook/model/fixtures';
import { indexDocument } from '$lib/graph/derive';
import {
	checkCode,
	choicesOf,
	choicesRunning,
	closestFact,
	complete,
	describe as words,
	factInfo,
	factTiming,
	sampleDay
} from './conditions';
import type { WorkItem } from '$lib/graph/derive';

const ix = indexDocument(incidentManagement);
const labels = (text: string, cursor = text.length) =>
	complete(ix, text, cursor).items.map((s) => s.label);

describe('conditions in the editor', () => {
	it('words conditions with the facts’ names', () => {
		expect(words(ix, "fact.severity in ['SEV1', 'SEV2']")).toBe('Severity is SEV1 or SEV2');
		expect(words(ix, 'fact.resolved-at != null')).toBe('Resolved at has a value');
		expect(factInfo(ix)('fact.severity').kind).toBe('choice');
		expect(choicesOf(ix, 'fact.severity')).toEqual(['SEV1', 'SEV2', 'SEV3', 'SEV4']);
	});

	it('finds code that does not work, and where', () => {
		expect(checkCode(ix, "fact.severity in ['SEV1']")).toBeUndefined();
		expect(checkCode(ix, 'fact.severty == 1')).toEqual({
			message:
				'This process has no fact called fact.severty. Did you mean Severity (fact.severity)?',
			at: 0,
			length: 12
		});
		expect(checkCode(ix, 'fact.severity == ')).toMatchObject({
			message: 'The expression ends too early.'
		});
		expect(checkCode(ix, 'days_since(fact.resolved-at) > 2 and frob')).toMatchObject({
			at: 37,
			length: 4
		});
	});

	it('suggests facts, helpers and words where a value goes', () => {
		const start = labels('');
		expect(start).toContain('Severity');
		expect(start).toContain('days_since(date)');
		expect(start).toContain('not');
		expect(labels('sev')).toEqual(['Severity']);
		expect(complete(ix, 'sev', 3).items[0]).toMatchObject({ insert: 'fact.severity' });
		expect(complete(ix, 'fact.severity == x and sev', 26).from).toBe(23);
		expect(labels('days')).toEqual([
			'days_since(date)',
			'days_between(from, to)',
			'add_days(date, days)'
		]);
	});

	it('suggests operators after a value, and a choice fact’s values after comparing it', () => {
		expect(labels('fact.severity ')).toContain('==');
		expect(labels('fact.severity ')).not.toContain('Severity');
		expect(labels('fact.severity == ').slice(0, 4)).toEqual(['SEV1', 'SEV2', 'SEV3', 'SEV4']);
		expect(labels("fact.severity in ['SEV1', ").slice(0, 1)).toEqual(['SEV1']);
		expect(labels('fact.severity == x a')).toEqual(['and']);
	});
});

describe('helping people pick facts', () => {
	it('suggests the fact someone probably meant', () => {
		expect(closestFact(ix, 'sev')?.id).toBe('fact.severity');
		expect(closestFact(ix, 'resolvd-at')?.id).toBe('fact.resolved-at');
		expect(closestFact(ix, 'zzzzzz')).toBeUndefined();
		expect(checkCode(ix, 'severity == 1')?.message).toMatch(/Did you mean Severity/);
	});

	it('knows which facts are recorded before a step, by it, or only later', () => {
		const timing = factTiming(ix, 'step.form-working-group');
		expect(timing.get('fact.severity')).toBe('before');
		expect(timing.get('fact.working-group')).toBe('self');
		expect(timing.get('fact.resolved-at')).toBe('later');
	});

	it('finds the choices a step runs for, whatever operator its condition uses', () => {
		const item = ix.byId.get('step.form-working-group') as WorkItem;
		expect(choicesRunning(item, 'fact.severity', ['SEV1', 'SEV2', 'SEV3', 'SEV4'])).toEqual([
			'SEV1',
			'SEV2'
		]);
		expect(choicesRunning(item, 'fact.other', ['a'])).toEqual([]);
	});

	it('counts a step for every choice its condition does not rule out, even when it waits on other facts', () => {
		const when = (expr: string) => ({ core: { when: { text: '', expr } } }) as unknown as WorkItem;
		const choices = ['A', 'B', 'C'];
		expect(choicesRunning(when("fact.d == 'A' and fact.x == 1"), 'fact.d', choices)).toEqual(['A']);
		expect(choicesRunning(when("fact.d == 'A' or fact.x == 1"), 'fact.d', choices)).toEqual(
			choices
		);
		expect(choicesRunning(when("fact.d in ['A', 'B']"), 'fact.d', choices)).toEqual(['A', 'B']);
		expect(choicesRunning(when('fact.d != null'), 'fact.d', choices)).toEqual([]);
	});
});

describe('sample dates in the test panel', () => {
	it('shows a date-time on the day it falls in the time zone, the day conditions compare', () => {
		expect(sampleDay('2026-10-19T17:16:00Z', 'Asia/Singapore')).toBe('2026-10-20');
		expect(sampleDay('2026-10-19T17:16:00Z', 'UTC')).toBe('2026-10-19');
	});

	it('shows a date as it is and anything else as no date', () => {
		expect(sampleDay('2026-10-19', 'Asia/Singapore')).toBe('2026-10-19');
		expect(sampleDay(undefined, 'UTC')).toBe('');
		expect(sampleDay('soon', 'UTC')).toBe('');
	});
});
