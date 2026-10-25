import { describe, expect, it } from 'vitest';
import { guardReferences } from '../src/index.js';

describe('guardReferences', () => {
	it('reads fact and role references', () => {
		expect(
			guardReferences("fact.severity in ['SEV1', 'SEV2'] && role.incident-commander in actor.roles")
		).toEqual({ facts: ['fact.severity'], roles: ['role.incident-commander'] });
	});

	it('takes the fact id from a property access', () => {
		expect(guardReferences("fact.address.country == 'NL'").facts).toEqual(['fact.address']);
	});

	it('ignores string literals and longer dotted names', () => {
		expect(
			guardReferences(`case.fact.ignored == "fact.in-quotes" || x == 'role.\\'quoted'`)
		).toEqual({ facts: [], roles: [] });
	});

	it('lists each reference once', () => {
		expect(guardReferences('fact.a > 1 && fact.a < 9').facts).toEqual(['fact.a']);
	});

	it('finds nothing in an expression without references', () => {
		expect(guardReferences('now() > deadline')).toEqual({ facts: [], roles: [] });
	});
});
