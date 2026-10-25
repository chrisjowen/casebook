import { describe, expect, it } from 'vitest';
import { incidentManagement } from '../fixtures/index.js';
import {
	addValues,
	apply,
	applyBatch,
	checkInvariants,
	choicesPatch,
	choiceProblem,
	choiceSource,
	describeValueChanges,
	factChoices,
	factsUsingLookup,
	factsUsingShared,
	freshLookupId,
	lookupListProblem,
	moveValue,
	newLookupNode,
	readValueLines,
	relabelValue,
	removeValue,
	setValueCode,
	setValueDisabled,
	sortValues,
	type DefinitionDocument,
	type FactNode,
	type LookupValue
} from '../src/index.js';

const schemaOf = (document: DefinitionDocument, id: string) =>
	(document.nodes.find((n) => n.core.id === id) as FactNode).core.schema;

const severity = schemaOf(incidentManagement, 'fact.severity');
const services = schemaOf(incidentManagement, 'fact.affected-services');

describe('factChoices', () => {
	it('reads a lookup node’s values, labels first', () => {
		expect(factChoices(incidentManagement, severity)?.slice(0, 2)).toEqual([
			{ value: 'SEV1', label: 'SEV1', description: 'A customer-facing service is down' },
			{ value: 'SEV2', label: 'SEV2', description: 'A major feature is broken or badly slow' }
		]);
	});

	it('reads a shared lookup when it is given, and nothing when it is not', () => {
		const shared = new Map([
			['service-catalog', { title: 'Services', values: [{ value: 'checkout', code: 'CHK' }] }]
		]);
		expect(factChoices(incidentManagement, services, shared)).toEqual([
			{ value: 'checkout', label: 'checkout', code: 'CHK' }
		]);
		expect(factChoices(incidentManagement, services)).toBeUndefined();
	});

	it('reads a fact’s own options, on it or on its items', () => {
		expect(factChoices(incidentManagement, { type: 'string', enum: ['a', 'b'] })).toEqual([
			{ value: 'a', label: 'a' },
			{ value: 'b', label: 'b' }
		]);
		expect(
			factChoices(incidentManagement, { type: 'array', items: { type: 'string', enum: ['x'] } })
		).toEqual([{ value: 'x', label: 'x' }]);
		expect(factChoices(incidentManagement, { type: 'string' })).toBeUndefined();
	});
});

describe('choiceSource', () => {
	it('names where a fact’s choices come from', () => {
		expect(choiceSource(incidentManagement, severity)).toEqual({
			kind: 'lookup',
			lookup: 'lookup.severity-levels',
			title: 'Severity levels'
		});
		expect(choiceSource(incidentManagement, services)).toEqual({
			kind: 'shared',
			name: 'service-catalog',
			title: 'service catalog',
			found: false
		});
		expect(choiceSource(incidentManagement, { type: 'string', enum: ['a'] })).toEqual({
			kind: 'own'
		});
		expect(choiceSource(incidentManagement, { type: 'number' })).toBeUndefined();
	});
});

describe('choicesPatch', () => {
	it('gives a fact its own options, clearing its lookup', () => {
		expect(choicesPatch(severity, { kind: 'own', options: ['a'] })).toEqual({
			'x-lookup': null,
			enum: ['a']
		});
		expect(choicesPatch(services, { kind: 'own', options: ['a'] })).toEqual({
			'x-lookup': null,
			items: { type: 'string', enum: ['a'] }
		});
	});
	it('points a fact at a shared lookup, clearing the old source', () => {
		expect(choicesPatch(severity, { kind: 'shared', name: 'countries' })).toEqual({
			'x-lookup': { kind: 'dataset', lookup: null, dataset: 'countries' },
			enum: null
		});
	});
});

describe('where lookups are used', () => {
	it('lists the facts chosen from a lookup or a shared lookup', () => {
		expect(factsUsingLookup(incidentManagement, 'lookup.severity-levels')).toEqual([
			'fact.severity'
		]);
		expect(factsUsingShared(incidentManagement, 'service-catalog')).toEqual([
			'fact.affected-services'
		]);
	});
});

describe('choiceProblem', () => {
	const choices = [
		{ value: 'a', label: 'Apple' },
		{ value: 'b', label: 'Banana', disabled: true }
	];
	it('accepts a choice, and a turned-off one only when the case already holds it', () => {
		expect(choiceProblem('Fruit', choices, 'a')).toBeUndefined();
		expect(choiceProblem('Fruit', choices, 'b')).toBe(
			'Fruit: Banana is no longer offered; choose another'
		);
		expect(choiceProblem('Fruit', choices, 'b', 'b')).toBeUndefined();
		expect(choiceProblem('Fruit', choices, ['a', 'b'], ['b'])).toBeUndefined();
	});
	it('refuses a value that is not a choice', () => {
		expect(choiceProblem('Fruit', choices, ['a', 'kiwi'])).toBe('Fruit: must be one of Apple');
		const many = Array.from({ length: 9 }, (_, i) => ({ value: `v${i}`, label: `V${i}` }));
		expect(choiceProblem('Fruit', many, 'kiwi')).toBe('Fruit: "kiwi" is not one of the choices');
	});
});

describe('editing values', () => {
	const values: LookupValue[] = [{ value: 'SEV1', label: 'Critical' }, { value: 'SEV2' }];

	it('reads typed or pasted values', () => {
		expect(readValueLines('Red, Green ,Blue')).toEqual([
			{ label: 'Red' },
			{ label: 'Green' },
			{ label: 'Blue' }
		]);
		expect(readValueLines('United Kingdom\tGB\nKorea, Republic of\tKR\n\n')).toEqual([
			{ label: 'United Kingdom', code: 'GB' },
			{ label: 'Korea, Republic of', code: 'KR' }
		]);
	});

	it('adds new values once, stored as their label', () => {
		expect(addValues(values, [{ label: 'SEV3', code: 'S3' }, { label: 'critical' }])).toEqual([
			...values,
			{ value: 'SEV3', code: 'S3' }
		]);
		expect(addValues(values, [{ label: 'sev2' }])).toBe('sev2 is already in the list');
	});

	it('renames a value but keeps what cases store', () => {
		expect(relabelValue(values, 'SEV2', 'Major')).toEqual([
			values[0],
			{ value: 'SEV2', label: 'Major' }
		]);
		expect(relabelValue(values, 'SEV1', 'SEV1')).toEqual([{ value: 'SEV1' }, values[1]]);
		expect(relabelValue(values, 'SEV2', 'critical')).toBe('critical is already in the list');
		expect(relabelValue(values, 'SEV2', ' ')).toBe('A value needs a name');
	});

	it('sets codes, turns values off and on, moves, removes and sorts them', () => {
		expect(setValueCode(values, 'SEV2', ' S2 ')).toEqual([
			values[0],
			{ value: 'SEV2', code: 'S2' }
		]);
		expect(setValueCode([{ value: 'a', code: 'x' }], 'a', '')).toEqual([{ value: 'a' }]);
		const off = setValueDisabled(values, 'SEV1', true) as LookupValue[];
		expect(off[0]).toEqual({ value: 'SEV1', label: 'Critical', disabled: true });
		expect(setValueDisabled(off, 'SEV1', false)).toEqual(values);
		expect(moveValue(values, 'SEV2', 0)).toEqual([values[1], values[0]]);
		expect(removeValue(values, 'SEV1')).toEqual([values[1]]);
		expect(sortValues([{ value: 'b' }, { value: 'a', disabled: true }, { value: 'C' }])).toEqual([
			{ value: 'b' },
			{ value: 'C' },
			{ value: 'a', disabled: true }
		]);
	});

	it('describes what changed', () => {
		expect(describeValueChanges(values, values)).toEqual([]);
		expect(
			describeValueChanges(values, [{ value: 'SEV2', disabled: true }, { value: 'SEV3' }])
		).toEqual(['added SEV3', 'removed Critical', 'turned off SEV2']);
	});
});

describe('lookupListProblem', () => {
	it('accepts a titled list of values', () => {
		expect(
			lookupListProblem({ title: 'Countries', values: [{ value: 'GB', label: 'United Kingdom' }] })
		).toBeUndefined();
	});
	it('explains what is wrong', () => {
		expect(lookupListProblem({ title: ' ', values: [] })).toBe('A lookup needs a name');
		expect(lookupListProblem({ title: 'A', values: [{ value: 'x' }, { value: 'x' }] })).toBe(
			'x is in the list twice'
		);
		expect(lookupListProblem({ title: 'A', values: [{ value: 'x', colour: 'red' }] })).toBe(
			'A value has no field "colour"'
		);
		expect(lookupListProblem({ title: 'A', values: [{ value: 'x', code: '' }] })).toBe(
			'The code of x cannot be empty'
		);
	});
});

describe('lookup nodes in a definition', () => {
	it('makes a fresh id from a title', () => {
		expect(freshLookupId(incidentManagement, 'Severity levels')).toBe('lookup.severity-levels-2');
		expect(freshLookupId(incidentManagement, 'Document types')).toBe('lookup.document-types');
	});

	it('refuses a fact chosen from a lookup that does not exist', () => {
		const result = apply(incidentManagement, {
			op: 'update_core',
			id: 'fact.severity',
			changes: { schema: { 'x-lookup': { kind: 'lookup', lookup: 'lookup.missing' } } }
		});
		expect(result).toMatchObject({ ok: false, code: 'broken-reference' });
	});

	it('refuses removing a lookup while a fact is chosen from it', () => {
		expect(
			apply(incidentManagement, { op: 'remove_node', id: 'lookup.severity-levels' })
		).toMatchObject({
			ok: false,
			code: 'referenced',
			reason: expect.stringContaining('fact.severity (core.schema["x-lookup"].lookup)')
		});
	});

	it('adds a lookup and points a fact at it in one edit', () => {
		const result = applyBatch(incidentManagement, [
			{
				op: 'add_node',
				node: newLookupNode('lookup.regions', 'Regions', [{ value: 'EU' }, { value: 'US' }])
			},
			{
				op: 'update_core',
				id: 'fact.affected-services',
				changes: { schema: choicesPatch(services, { kind: 'lookup', lookup: 'lookup.regions' }) }
			}
		]);
		if (!result.ok) throw new Error(result.reason);
		expect(schemaOf(result.document, 'fact.affected-services')).toEqual({
			type: 'array',
			minItems: 1,
			items: { type: 'string' },
			'x-lookup': { kind: 'lookup', lookup: 'lookup.regions' }
		});
	});

	it('checks values: duplicates and an empty list block publishing, an unused list warns', () => {
		const result = applyBatch(incidentManagement, [
			{ op: 'add_node', node: newLookupNode('lookup.spare', 'Spare', [{ value: 'x' }]) },
			{
				op: 'update_core',
				id: 'lookup.severity-levels',
				changes: { values: [{ value: 'SEV1', disabled: true }, { value: 'SEV1' }] }
			}
		]);
		if (!result.ok) throw new Error(result.reason);
		const issues = checkInvariants(result.document).filter((i) => i.code.includes('lookup'));
		expect(issues.map((i) => [i.code, i.severity, i.nodeId])).toEqual([
			['duplicate-lookup-value', 'error', 'lookup.severity-levels'],
			['unused-lookup', 'warning', 'lookup.spare']
		]);
		const off = apply(incidentManagement, {
			op: 'update_core',
			id: 'lookup.severity-levels',
			changes: { values: [{ value: 'SEV1', disabled: true }] }
		});
		if (!off.ok) throw new Error(off.reason);
		expect(off.warnings.filter((i) => i.code === 'empty-lookup')).toMatchObject([
			{ severity: 'error', message: expect.stringContaining('no values that can be chosen') }
		]);
	});
});
