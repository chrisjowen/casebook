import { describe, expect, it } from 'vitest';
import { evaluateGuard, GuardSyntaxError, parseGuard } from '../../src/index.js';

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
