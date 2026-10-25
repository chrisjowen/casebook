import { describe, expect, it } from 'vitest';
import {
	conditionKind,
	describeGuard,
	evaluateGuard,
	fromCondition,
	isComplete,
	operatorsFor,
	toCondition,
	type ConditionKind,
	type FactInfo,
	type Group
} from '../src/index.js';

const kinds: Record<string, ConditionKind> = {
	'fact.severity': 'choice',
	'fact.customers': 'number',
	'fact.resolved-at': 'date',
	'fact.translation-required': 'yesno',
	'fact.teams': 'list',
	'fact.summary': 'text'
};
const info: FactInfo = (fact) => ({
	name: fact
		.slice('fact.'.length)
		.replaceAll('-', ' ')
		.replace(/^./, (c) => c.toUpperCase()),
	kind: kinds[fact] ?? 'text'
});

describe('conditionKind', () => {
	it('reads the kind from the schema', () => {
		expect(conditionKind({ type: 'string', enum: ['a'] })).toBe('choice');
		expect(conditionKind({ type: 'string', format: 'date' })).toBe('date');
		expect(conditionKind({ type: 'boolean' })).toBe('yesno');
		expect(conditionKind({ type: 'integer' })).toBe('number');
		expect(conditionKind({ type: 'array', 'x-lookup': { kind: 'principal' } })).toBe('people');
		expect(conditionKind({ type: 'string', 'x-lookup': { kind: 'dataset', dataset: 'x' } })).toBe(
			'lookup'
		);
		expect(conditionKind({ type: 'string', 'x-evidence': { description: 'scan' } })).toBe(
			'document'
		);
	});

	it('offers operators that fit the kind', () => {
		expect(operatorsFor('date')).toContain('lt');
		expect(operatorsFor('date')).toContain('more-days-ago');
		expect(operatorsFor('yesno')).not.toContain('gt');
		expect(operatorsFor('people')).toContain('contains');
	});
});

describe('toCondition and fromCondition', () => {
	const roundTrip = [
		"fact.severity in ['SEV1', 'SEV2']",
		'fact.translation-required == true',
		"fact.insurer-decision != 'declined'",
		'fact.resolved-at != null',
		'fact.resolved-at == null',
		'fact.customers >= 10',
		"not (fact.severity in ['SEV3'])",
		"contains(fact.teams, 'Payments')",
		"not contains(fact.summary, 'test')",
		'days_since(fact.resolved-at) > 3',
		'days_since(fact.resolved-at) < 3',
		'count(fact.teams) >= 2',
		'count(fact.teams) <= 2',
		'fact.resolved-at < today()',
		"fact.severity == 'SEV1' and fact.customers > 10",
		"fact.severity == 'SEV1' or (fact.customers > 10 and fact.translation-required == false)"
	];

	it.each(roundTrip)('reads and writes back %s', (expr) => {
		const condition = toCondition(expr);
		expect(condition).toBeDefined();
		expect(fromCondition(condition!)).toBe(expr);
	});

	it('reads the fixture guards as rows', () => {
		expect(toCondition("fact.severity in ['SEV1', 'SEV2']")).toEqual({
			kind: 'group',
			join: 'all',
			items: [{ kind: 'rule', fact: 'fact.severity', op: 'one-of', value: ['SEV1', 'SEV2'] }]
		});
	});

	it('flips a value written first, and reads helpers', () => {
		expect(fromCondition(toCondition('3 < fact.customers')!)).toBe('fact.customers > 3');
		expect(fromCondition(toCondition('null == fact.x')!)).toBe('fact.x == null');
		expect(fromCondition(toCondition('is_set(fact.x)')!)).toBe('fact.x != null');
	});

	it('leaves expressions without rows to the code view', () => {
		expect(toCondition('not (fact.a == 1 or fact.b == 2)')).toBeUndefined();
		expect(toCondition('fact.a')).toBeUndefined();
		expect(toCondition('fact.a == fact.b')).toBeUndefined();
		expect(toCondition('fact.a ==')).toBeUndefined();
	});

	it('writes what the rows mean, skipping unfinished rows', () => {
		const group: Group = {
			kind: 'group',
			join: 'any',
			items: [
				{ kind: 'rule', fact: 'fact.severity', op: 'is', value: "it's" },
				{ kind: 'rule', fact: 'fact.customers', op: 'gt' },
				{ kind: 'group', join: 'all', items: [] }
			]
		};
		expect(fromCondition(group)).toBe("fact.severity == 'it\\'s'");
		expect(evaluateGuard(fromCondition(group)!, { 'fact.severity': "it's" })).toBe(true);
		expect(fromCondition({ kind: 'group', join: 'all', items: [] })).toBeUndefined();
		expect(isComplete({ kind: 'rule', fact: '', op: 'set' })).toBe(false);
		expect(isComplete({ kind: 'rule', fact: 'fact.a', op: 'one-of', value: [] })).toBe(false);
	});
});

describe('describeGuard', () => {
	it.each([
		["fact.severity in ['SEV1', 'SEV2']", 'Severity is SEV1 or SEV2'],
		["fact.severity in ['SEV1', 'SEV2', 'SEV3']", 'Severity is SEV1, SEV2 or SEV3'],
		['fact.translation-required == true', 'Translation required is Yes'],
		['fact.resolved-at != null', 'Resolved at has a value'],
		["fact.resolved-at < '2026-01-15'", 'Resolved at is before 15 Jan 2026'],
		['fact.resolved-at >= today()', 'Resolved at is on or after today'],
		['days_since(fact.resolved-at) > 3', 'Resolved at is more than 3 days ago'],
		['fact.customers > 10', 'Customers is more than 10'],
		["contains(fact.teams, 'Payments')", 'Teams includes Payments'],
		["contains(fact.summary, 'test')", 'Summary contains “test”'],
		['count(fact.teams) >= 2', 'Teams has at least 2'],
		[
			"fact.severity == 'SEV1' or (fact.customers > 10 and fact.translation-required == false)",
			'Severity is SEV1 or (Customers is more than 10 and Translation required is No)'
		],
		['not (fact.customers == 1 or fact.customers == 2)', 'not (Customers is 1 or Customers is 2)'],
		['days_between(fact.resolved-at, today()) > 2', 'days from Resolved at to today is more than 2']
	])('words %s', (expr, words) => {
		expect(describeGuard(expr, info)).toBe(words);
	});

	it('is undefined for code that does not parse', () => {
		expect(describeGuard('fact.a ==', info)).toBeUndefined();
	});
});
