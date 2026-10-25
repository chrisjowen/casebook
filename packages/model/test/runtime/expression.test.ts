import { describe, expect, it } from 'vitest';
import { evaluateGuard, explainGuard, GuardSyntaxError, parseGuard } from '../../src/index.js';

describe('evaluateGuard', () => {
	it('evaluates the fixture guards', () => {
		expect(
			evaluateGuard('fact.translation-required == true', { 'fact.translation-required': true })
		).toBe(true);
		expect(evaluateGuard("fact.severity in ['SEV1', 'SEV2']", { 'fact.severity': 'SEV3' })).toBe(
			false
		);
		expect(evaluateGuard("fact.severity in ['SEV1', 'SEV2']", { 'fact.severity': 'SEV1' })).toBe(
			true
		);
		expect(
			evaluateGuard("fact.insurer-decision != 'declined'", { 'fact.insurer-decision': 'approved' })
		).toBe(true);
	});

	it('is unknown while a fact it reads is not recorded', () => {
		expect(evaluateGuard("fact.severity in ['SEV1']", {})).toBeUndefined();
		expect(evaluateGuard('fact.a > 3', {})).toBeUndefined();
	});

	it('counts a missing fact as null when compared with null', () => {
		expect(evaluateGuard('fact.resolved-at != null', {})).toBe(false);
		expect(
			evaluateGuard('fact.resolved-at != null', { 'fact.resolved-at': '2026-10-25T10:00:00Z' })
		).toBe(true);
		expect(evaluateGuard('null == fact.x', {})).toBe(true);
	});

	it('uses three-valued logic', () => {
		expect(evaluateGuard('fact.a == 1 && fact.b == 2', { 'fact.a': 0 })).toBe(false);
		expect(evaluateGuard('fact.a == 1 || fact.b == 2', { 'fact.a': 1 })).toBe(true);
		expect(evaluateGuard('fact.a == 1 || fact.b == 2', { 'fact.a': 0 })).toBeUndefined();
		expect(evaluateGuard('not (fact.a == 1) and fact.b', { 'fact.a': 2, 'fact.b': true })).toBe(
			true
		);
	});

	it('compares numbers and strings, and reads properties', () => {
		expect(evaluateGuard('fact.years >= 3', { 'fact.years': 4 })).toBe(true);
		expect(evaluateGuard('fact.years < 3', { 'fact.years': 4 })).toBe(false);
		expect(
			evaluateGuard("fact.address.country == 'NL'", { 'fact.address': { country: 'NL' } })
		).toBe(true);
		expect(
			evaluateGuard("fact.address.city == 'Delft'", { 'fact.address': { country: 'NL' } })
		).toBeUndefined();
	});

	it('refuses anything outside the language', () => {
		expect(() => parseGuard('fetch("x")')).toThrow(GuardSyntaxError);
		expect(() => parseGuard('fact.a ==')).toThrow(GuardSyntaxError);
		expect(() => parseGuard('fact.a == 1 1')).toThrow(GuardSyntaxError);
		expect(() => evaluateGuard('role.parent == true', {})).toThrow(GuardSyntaxError);
	});
});

describe('guard helpers', () => {
	const now = new Date('2026-10-26T15:00:00Z');
	const at = (expr: string, facts: Record<string, unknown> = {}) =>
		evaluateGuard(expr, facts, { now });

	it('reads today and counts days', () => {
		expect(at("today() == '2026-10-26'")).toBe(true);
		expect(at('days_since(fact.reported) > 3', { 'fact.reported': '2026-10-20' })).toBe(true);
		expect(at('days_since(fact.reported) > 3', { 'fact.reported': '2026-10-25T23:00:00Z' })).toBe(
			false
		);
		expect(
			at('days_between(fact.a, fact.b) == 30', { 'fact.a': '2026-01-01', 'fact.b': '2026-01-31' })
		).toBe(true);
		expect(at('fact.due < add_days(today(), 7)', { 'fact.due': '2026-10-30' })).toBe(true);
		expect(at("add_days('2026-02-27', 2) == '2026-03-01'")).toBe(true);
	});

	it('looks inside lists and text, ignoring case for text', () => {
		expect(at("contains(fact.teams, 'Payments')", { 'fact.teams': ['Payments', 'Web'] })).toBe(
			true
		);
		expect(at("contains(fact.teams, 'payments')", { 'fact.teams': ['Payments'] })).toBe(false);
		expect(at("contains(fact.note, 'URGENT')", { 'fact.note': 'this is urgent' })).toBe(true);
		expect(at('count(fact.teams) >= 2', { 'fact.teams': ['a', 'b'] })).toBe(true);
		expect(at('count(fact.teams) == 0', { 'fact.teams': null })).toBe(true);
	});

	it('knows whether something is set even when nothing is recorded', () => {
		expect(at('is_set(fact.x)')).toBe(false);
		expect(at('is_empty(fact.x)')).toBe(true);
		expect(at('is_empty(fact.x)', { 'fact.x': [] })).toBe(true);
		expect(at('is_set(fact.x)', { 'fact.x': 'a' })).toBe(true);
	});

	it('is unknown while a helper reads an unrecorded fact', () => {
		expect(at('days_since(fact.reported) > 3')).toBeUndefined();
		expect(at('count(fact.teams) > 1')).toBeUndefined();
	});

	it('refuses wrong calls, with where the problem is', () => {
		expect(() => parseGuard('today')).toThrow(/needs brackets/);
		expect(() => parseGuard('count()')).toThrow(/takes one value/);
		expect(() => at('days_since(fact.x) > 1', { 'fact.x': 'soon' })).toThrow(/needs a date/);
		try {
			parseGuard('fact.a == 1 and nope(fact.b)');
		} catch (error) {
			expect(error).toBeInstanceOf(GuardSyntaxError);
			expect((error as GuardSyntaxError).at).toBe(16);
		}
		expect(() => parseGuard("fact.a == 'open")).toThrow(/no closing quote/);
		expect(() => parseGuard('   ')).toThrow(/empty/);
	});

	it('counts a week as seven days', () => {
		expect(at('days_since(fact.opened) >= 7', { 'fact.opened': '2026-10-19' })).toBe(true);
	});
});

describe('calendar days', () => {
	it('counts days in the time zone it is given', () => {
		const now = new Date('2026-10-26T20:00:00Z');
		const singapore = { now, timeZone: 'Asia/Singapore' };
		expect(evaluateGuard("today() == '2026-10-27'", {}, singapore)).toBe(true);
		expect(evaluateGuard("today() == '2026-10-26'", {}, { now })).toBe(true);
		const reported = { 'fact.reported': '2026-10-26T17:00:00Z' };
		expect(evaluateGuard('days_since(fact.reported) == 0', reported, { now })).toBe(true);
		expect(evaluateGuard('days_since(fact.reported) == 0', reported, singapore)).toBe(true);
		expect(
			evaluateGuard(
				'days_since(fact.reported) == 1',
				{ 'fact.reported': '2026-10-26T15:00:00Z' },
				singapore
			)
		).toBe(true);
		expect(evaluateGuard("add_days(fact.reported, 1) == '2026-10-28'", reported, singapore)).toBe(
			true
		);
		expect(
			evaluateGuard(
				'days_between(fact.a, fact.b) == 1',
				{ 'fact.a': '2026-10-26T15:00:00Z', 'fact.b': '2026-10-26T17:00:00Z' },
				singapore
			)
		).toBe(true);
	});

	it('compares a date-time with a date by the day it falls on', () => {
		const at = { 'fact.at': '2026-10-26T09:00:00Z' };
		const on = (expr: string, options = {}) => evaluateGuard(expr, at, options);
		expect(on("fact.at == '2026-10-26'")).toBe(true);
		expect(on("fact.at != '2026-10-26'")).toBe(false);
		expect(on("fact.at > '2026-10-26'")).toBe(false);
		expect(on("fact.at <= '2026-10-26'")).toBe(true);
		expect(on("fact.at >= '2026-10-26'")).toBe(true);
		expect(on("fact.at < '2026-10-27'")).toBe(true);
		expect(on("'2026-10-26' == fact.at")).toBe(true);
		const now = new Date('2026-10-26T12:00:00Z');
		expect(on('fact.at == today()', { now })).toBe(true);
		expect(on('fact.at > today()', { now })).toBe(false);
		expect(on("fact.at == '2026-10-26'", { timeZone: 'America/Los_Angeles' })).toBe(true);
		expect(
			evaluateGuard(
				"fact.at == '2026-10-27'",
				{ 'fact.at': '2026-10-26T20:00:00Z' },
				{
					timeZone: 'Asia/Singapore'
				}
			)
		).toBe(true);
		expect(
			evaluateGuard('fact.a < fact.b', {
				'fact.a': '2026-10-26T09:00:00Z',
				'fact.b': '2026-10-26T10:00:00Z'
			})
		).toBe(true);
	});
});

describe('explainGuard', () => {
	it('shows which part decided the answer', () => {
		const trace = explainGuard("fact.severity in ['SEV1', 'SEV2'] and fact.customers > 10", {
			'fact.severity': 'SEV1',
			'fact.customers': 3
		});
		expect(trace.result).toBe('false');
		expect(trace.parts.map((p) => [p.text, p.result])).toEqual([
			["fact.severity in ['SEV1', 'SEV2']", 'true'],
			['fact.customers > 10', 'false']
		]);
	});

	it('names the facts a part is waiting for, and keeps errors to their part', () => {
		const trace = explainGuard('fact.a == 1 or days_since(fact.b) > 2', { 'fact.b': 'x' });
		expect(trace.parts[0]).toMatchObject({ result: 'unknown', missing: ['fact.a'] });
		expect(trace.parts[1]).toMatchObject({ result: 'error' });
		expect(trace.parts[1]!.error).toMatch(/needs a date/);
	});
});
