import { describe, expect, it } from 'vitest';
import {
	alternativeCollector,
	birthRegistrationAbroad,
	dependencyCycle,
	duplicateId,
	incidentManagement,
	missingProcess,
	multipleProcesses,
	recollectedFact,
	selfDependency,
	uncollectedFact,
	uncollectedReads,
	undeclaredRole,
	unknownGuardFact,
	unresolvedReferences,
	unusedNodes
} from '../fixtures/index.js';
import { checkInvariants, checkPublish, type DefinitionDocument } from '../src/index.js';

function codesOf(document: DefinitionDocument) {
	return checkInvariants(document).map((i) => [i.code, i.severity, i.nodeId]);
}

describe('checkInvariants', () => {
	it.each([
		['incident management', incidentManagement],
		['birth registration abroad', birthRegistrationAbroad]
	])('finds nothing wrong with %s', (_name, document) => {
		expect(checkInvariants(document)).toEqual([]);
	});

	it('finds a dependency cycle between steps and explains it', () => {
		expect(checkInvariants(dependencyCycle)).toEqual([
			{
				code: 'dependency-cycle',
				severity: 'error',
				path: '/nodes/5/core/requires/0',
				nodeId: 'step.prepare-quote',
				message:
					'dependency cycle: step.prepare-quote requires fact.order from step.place-order; ' +
					'step.place-order requires fact.quote from step.prepare-quote. ' +
					'None of step.prepare-quote and step.place-order can start',
				related: ['step.prepare-quote', 'step.place-order']
			}
		]);
	});

	it('finds a step that requires the fact it collects', () => {
		expect(checkInvariants(selfDependency)).toEqual([
			expect.objectContaining({
				code: 'dependency-cycle',
				nodeId: 'step.sign',
				message:
					'dependency cycle: step.sign requires fact.signature, which it collects itself. step.sign can never start'
			})
		]);
	});

	it.each([
		['a step re-collects a fact another step collects', recollectedFact],
		['a required fact has a collector outside the loop', alternativeCollector]
	])('finds no cycle when %s', (_name, document) => {
		expect(checkInvariants(document)).toEqual([]);
		expect(checkPublish(document).ok).toBe(true);
	});

	it('finds a required fact that nothing collects', () => {
		expect(checkInvariants(uncollectedFact)).toEqual([
			{
				code: 'uncollected-fact',
				severity: 'error',
				path: '/nodes/3',
				nodeId: 'fact.invoice-number',
				message:
					'fact.invoice-number is required by step.record-payment, but no step or decision collects it',
				related: ['step.record-payment']
			}
		]);
	});

	it('warns about facts read by assigns, evidence and lookups that nothing collects', () => {
		expect(checkInvariants(uncollectedReads).map((i) => [i.code, i.severity, i.message])).toEqual([
			[
				'uncollected-read-fact',
				'warning',
				'fact.region is read by fact.office, but no step or decision collects it'
			],
			[
				'uncollected-read-fact',
				'warning',
				'fact.receipt is read by step.form-group, but no step or decision collects it'
			],
			[
				'uncollected-read-fact',
				'warning',
				'fact.responders is read by step.form-group, but no step or decision collects it'
			]
		]);
		expect(checkPublish(uncollectedReads).ok).toBe(true);
	});

	it('finds every undeclared role: step, collector, lookup and guard', () => {
		expect(checkInvariants(undeclaredRole).map((i) => [i.code, i.path, i.message])).toEqual([
			[
				'undeclared-role',
				'/nodes/3/core/schema/x-lookup/role',
				'fact.reviewer core.schema["x-lookup"].role refers to role.reviewer, which is not declared'
			],
			[
				'undeclared-role',
				'/nodes/4/core/role',
				'step.assign-reviewer core.role refers to role.manager, which is not declared'
			],
			[
				'undeclared-role',
				'/nodes/4/core/collects/0/by',
				'step.assign-reviewer core.collects[0].by refers to role.supervisor, which is not declared'
			],
			[
				'undeclared-role',
				'/nodes/4/core/when/expr',
				'step.assign-reviewer has a guard (core.when.expr) that refers to role.auditor, which is not declared'
			]
		]);
	});

	it('finds guard expressions that read undeclared facts, ignoring string literals', () => {
		expect(checkInvariants(unknownGuardFact).map((i) => [i.code, i.nodeId, i.message])).toEqual([
			[
				'unknown-guard-fact',
				'step.escalate',
				'step.escalate has a guard (core.when.expr) that refers to fact.approval-limit, which is not declared'
			],
			[
				'unknown-guard-fact',
				'step.escalate',
				'step.escalate has a guard (core.when.expr) that refers to fact.currency, which is not declared'
			]
		]);
	});

	it('lets guards with only prose through', () => {
		const step = incidentManagement.nodes.find((n) => n.core.id === 'step.write-rca');
		expect(step?.core.kind === 'step' && step.core.when).toEqual({
			text: expect.any(String)
		});
		expect(checkInvariants(incidentManagement)).toEqual([]);
	});

	it('finds unresolved stage, fact and approval references', () => {
		expect(codesOf(unresolvedReferences)).toEqual([
			['unknown-stage', 'error', 'step.file-report'],
			['unknown-fact', 'error', 'step.file-report'],
			['unknown-approval', 'error', 'step.file-report'],
			['empty-stage', 'warning', 'stage.main']
		]);
	});

	it('finds duplicate ids', () => {
		expect(checkInvariants(duplicateId)).toEqual([
			{
				code: 'duplicate-id',
				severity: 'error',
				path: '/nodes/4/core/id',
				nodeId: 'fact.total',
				message: 'fact.total is declared more than once (nodes 3 and 4); ids must be unique'
			}
		]);
	});

	it('requires exactly one process node', () => {
		expect(codesOf(missingProcess)).toEqual([['missing-process', 'error', undefined]]);
		expect(codesOf(multipleProcesses)).toEqual([['multiple-processes', 'error', 'process.second']]);
	});

	it('warns about unused facts, empty stages and guards on uncollected facts', () => {
		expect(codesOf(unusedNodes)).toEqual([
			['uncollected-read-fact', 'warning', 'fact.priority'],
			['empty-stage', 'warning', 'stage.later'],
			['unused-fact', 'warning', 'fact.orphan']
		]);
	});
});

describe('checkPublish', () => {
	it('passes a valid, consistent definition', () => {
		expect(checkPublish(incidentManagement)).toEqual({ ok: true, errors: [], issues: [] });
	});

	it('passes a definition that only has warnings', () => {
		const result = checkPublish(unusedNodes);
		expect(result.ok).toBe(true);
		expect(result.issues).toHaveLength(3);
	});

	it('fails on invariant errors', () => {
		const result = checkPublish(dependencyCycle);
		expect(result.ok).toBe(false);
		expect(result.issues.map((i) => i.code)).toEqual(['dependency-cycle']);
	});

	it('fails on schema errors without running the invariant checks', () => {
		const result = checkPublish({ ...incidentManagement, version: 0 });
		expect(result).toEqual({
			ok: false,
			errors: [
				expect.objectContaining({ path: '/version', message: 'version must be at least 1' })
			],
			issues: []
		});
	});
});
