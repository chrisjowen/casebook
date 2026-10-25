import { describe, expect, it } from 'vitest';
import {
	factValueProblem,
	fileReference,
	isFileFact,
	readFactInput,
	referencedFile,
	workApprovalProblem,
	type FactNode
} from '../../src/index.js';
import { birthRegistrationAbroad, incidentManagement } from '../../fixtures/index.js';

const fact = (id: string) =>
	[...incidentManagement.nodes, ...birthRegistrationAbroad.nodes].find(
		(n) => n.core.id === id
	) as FactNode;

describe('readFactInput', () => {
	it('reads text into the fact’s type', () => {
		expect(readFactInput({ type: 'boolean' }, ['yes'])).toEqual({ ok: true, value: true });
		expect(readFactInput({ type: 'number' }, ['€1,840'])).toEqual({ ok: true, value: 1840 });
		expect(readFactInput({ type: 'array', items: { type: 'string' } }, ['a\nb', 'c'])).toEqual({
			ok: true,
			value: ['a', 'b', 'c']
		});
		expect(readFactInput({ type: 'string' }, ['  x '])).toEqual({ ok: true, value: 'x' });
	});

	it('is missing when nothing was entered, and says what is wrong otherwise', () => {
		expect(readFactInput({ type: 'string' }, ['  '])).toEqual({ ok: true, value: undefined });
		expect(readFactInput({ type: 'number' }, ['lots'])).toEqual({
			ok: false,
			problem: '"lots" is not a number'
		});
	});
});

describe('factValueProblem', () => {
	it('accepts valid values', () => {
		expect(factValueProblem(fact('fact.severity'), 'SEV2')).toBeUndefined();
		expect(factValueProblem(fact('fact.date-of-birth'), '2026-01-15')).toBeUndefined();
		expect(factValueProblem(fact('fact.parent-passport-numbers'), ['X0000001'])).toBeUndefined();
	});

	it('explains invalid values in words, naming the fact', () => {
		expect(factValueProblem(fact('fact.severity'), 'SEV9')).toBe(
			'Severity: must be one of SEV1, SEV2, SEV3, SEV4'
		);
		expect(factValueProblem(fact('fact.date-of-birth'), '15/01/2026')).toBe(
			'Date of birth: must be a date such as 2026-01-15'
		);
		expect(factValueProblem(fact('fact.consular-reference'), 'CR-1')).toMatch(
			/does not match the expected format, such as "CR-000042"/
		);
	});

	it('takes a stored file as the value of a file fact', () => {
		const rca = fact('fact.rca-document');
		expect(isFileFact(rca.core.schema)).toBe(true);
		const ref = fileReference('6f1c2a7e-0000-4000-8000-000000000001');
		expect(factValueProblem(rca, ref)).toBeUndefined();
		expect(referencedFile(ref)).toBe('6f1c2a7e-0000-4000-8000-000000000001');
	});
});

describe('workApprovalProblem', () => {
	const user = (id: string) => ({ id, kind: 'user' as const });

	it('allows another person to approve', () => {
		expect(
			workApprovalProblem({ approver: user('jordan'), doneBy: user('priya') })
		).toBeUndefined();
	});

	it('refuses agents, approving for someone else, and approving your own work', () => {
		expect(
			workApprovalProblem({ approver: { id: 'a', kind: 'agent' }, doneBy: user('priya') })
		).toMatch(/human-only/);
		expect(
			workApprovalProblem({
				approver: user('jordan'),
				approverOnBehalfOf: user('x'),
				doneBy: user('priya')
			})
		).toMatch(/for themselves/);
		expect(workApprovalProblem({ approver: user('priya'), doneBy: user('priya') })).toMatch(
			/own work/
		);
		expect(
			workApprovalProblem({
				approver: user('priya'),
				doneBy: { id: 'agent' },
				doneOnBehalfOf: user('priya')
			})
		).toMatch(/own work/);
	});
});
