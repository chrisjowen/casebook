import { describe, expect, it } from 'vitest';
import schema from '../schema/process-definition.schema.json' with { type: 'json' };
import * as fixtures from '../fixtures/index.js';
import {
	ACTOR_POLICIES,
	LOOKUP_KINDS,
	NODE_KINDS,
	ROLE_SCOPES,
	SCHEMA_VERSION,
	SENSITIVITY_LEVELS,
	validate,
	type ApprovalCore,
	type Collect,
	type CoreByKind,
	type DecisionCore,
	type DefinitionDocument,
	type EvidenceRequirement,
	type FactCore,
	type FactSchema,
	type Guard,
	type Lookup,
	type LookupCore,
	type LookupValue,
	type Node,
	type NodeKind,
	type ProcessCore,
	type Repeat,
	type RoleAssignment,
	type RoleCore,
	type SourceRef,
	type StageCore,
	type StepCore,
	type StepEvidence
} from '../src/index.js';

/**
 * The schema and the types are written by hand, so these tests hold them together: every fixture
 * is type-checked as a `DefinitionDocument` and must also pass the schema, and every object shape
 * declares the same fields on both sides. `satisfies Record<keyof T, true>` fails to compile if a
 * list below misses or invents a field of the type.
 */

type LookupOf<K extends Lookup['kind']> = Extract<Lookup, { kind: K }>;

type RequiredKeys<T> = { [K in keyof T]-?: object extends Pick<T, K> ? never : K }[keyof T];

const { $defs } = schema;
const stepProperties = $defs.stepCore.properties;

const shapes: [name: string, schemaFields: object, typeFields: object][] = [
	[
		'DefinitionDocument',
		schema.properties,
		{
			$schema: true,
			schemaVersion: true,
			namespace: true,
			slug: true,
			version: true,
			nodes: true
		} satisfies Record<keyof DefinitionDocument, true>
	],
	[
		'Node',
		$defs.node.properties,
		{ core: true, content: true, data: true } satisfies Record<keyof Node, true>
	],
	[
		'ProcessCore',
		$defs.processCore.properties,
		{ id: true, kind: true, title: true, source: true, invariants: true } satisfies Record<
			keyof ProcessCore,
			true
		>
	],
	[
		'StageCore',
		$defs.stageCore.properties,
		{ id: true, kind: true, title: true, source: true, invariants: true } satisfies Record<
			keyof StageCore,
			true
		>
	],
	[
		'StepCore',
		stepProperties,
		{
			id: true,
			kind: true,
			title: true,
			stage: true,
			role: true,
			actor: true,
			requires: true,
			collects: true,
			evidence: true,
			assigns: true,
			when: true,
			repeat: true,
			approval: true,
			source: true,
			invariants: true
		} satisfies Record<keyof StepCore, true>
	],
	[
		'FactCore',
		$defs.factCore.properties,
		{
			id: true,
			kind: true,
			title: true,
			schema: true,
			source: true,
			invariants: true
		} satisfies Record<keyof FactCore, true>
	],
	[
		'RoleCore',
		$defs.roleCore.properties,
		{
			id: true,
			kind: true,
			title: true,
			scope: true,
			source: true,
			invariants: true
		} satisfies Record<keyof RoleCore, true>
	],
	[
		'DecisionCore',
		$defs.decisionCore.properties,
		{
			id: true,
			kind: true,
			title: true,
			stage: true,
			role: true,
			actor: true,
			requires: true,
			outcome: true,
			when: true,
			source: true,
			invariants: true
		} satisfies Record<keyof DecisionCore, true>
	],
	[
		'ApprovalCore',
		$defs.approvalCore.properties,
		{
			id: true,
			kind: true,
			title: true,
			role: true,
			actor: true,
			requires: true,
			when: true,
			source: true,
			invariants: true
		} satisfies Record<keyof ApprovalCore, true>
	],
	[
		'LookupCore',
		$defs.lookupCore.properties,
		{
			id: true,
			kind: true,
			title: true,
			values: true,
			source: true,
			invariants: true
		} satisfies Record<keyof LookupCore, true>
	],
	[
		'LookupValue',
		$defs.lookupValue.properties,
		{ value: true, label: true, code: true, disabled: true } satisfies Record<
			keyof LookupValue,
			true
		>
	],
	['Guard', $defs.guard.properties, { text: true, expr: true } satisfies Record<keyof Guard, true>],
	[
		'SourceRef',
		$defs.source.properties,
		{ doc: true, ref: true, inferred: true } satisfies Record<keyof SourceRef, true>
	],
	[
		'EvidenceRequirement',
		$defs.evidence.properties,
		{ description: true, formats: true, copies: true } satisfies Record<
			keyof EvidenceRequirement,
			true
		>
	],
	[
		'StepEvidence',
		stepProperties.evidence.items.properties,
		{ description: true, formats: true, copies: true, fact: true } satisfies Record<
			keyof StepEvidence,
			true
		>
	],
	[
		'Collect',
		stepProperties.collects.items.properties,
		{ fact: true, by: true } satisfies Record<keyof Collect, true>
	],
	[
		'RoleAssignment',
		stepProperties.assigns.items.properties,
		{ role: true, fact: true } satisfies Record<keyof RoleAssignment, true>
	],
	[
		'Repeat',
		stepProperties.repeat.properties,
		{ until: true, every: true } satisfies Record<keyof Repeat, true>
	],
	[
		'FactSchema extensions',
		$defs.factSchema.properties,
		{ 'x-lookup': true, 'x-evidence': true, 'x-sensitivity': true } satisfies Record<
			keyof Pick<FactSchema, 'x-lookup' | 'x-evidence' | 'x-sensitivity'>,
			true
		>
	],
	[
		'dataset lookup',
		$defs.lookup.allOf[0]?.then.properties ?? {},
		{ kind: true, dataset: true, version: true } satisfies Record<keyof LookupOf<'dataset'>, true>
	],
	[
		'principal lookup',
		$defs.lookup.allOf[1]?.then.properties ?? {},
		{ kind: true, role: true } satisfies Record<keyof LookupOf<'principal'>, true>
	],
	[
		'fact lookup',
		$defs.lookup.allOf[2]?.then.properties ?? {},
		{ kind: true, fact: true } satisfies Record<keyof LookupOf<'fact'>, true>
	],
	[
		'case lookup',
		$defs.lookup.allOf[3]?.then.properties ?? {},
		{ kind: true, process: true } satisfies Record<keyof LookupOf<'case'>, true>
	],
	[
		'lookup lookup',
		$defs.lookup.allOf[4]?.then.properties ?? {},
		{ kind: true, lookup: true } satisfies Record<keyof LookupOf<'lookup'>, true>
	]
];

describe('schema and types agree', () => {
	it.each(Object.entries(fixtures))('%s is valid against the schema', (_name, fixture) => {
		const document: DefinitionDocument = fixture;
		expect(validate(document).errors).toEqual([]);
	});

	it.each(shapes)('%s declares the same fields', (_name, schemaFields, typeFields) => {
		expect(Object.keys(schemaFields).sort()).toEqual(Object.keys(typeFields).sort());
	});

	it('requires the same fields on each node kind', () => {
		const required: { [K in NodeKind]: Record<RequiredKeys<CoreByKind[K]>, true> } = {
			process: { id: true, kind: true },
			stage: { id: true, kind: true },
			step: { id: true, kind: true, stage: true, role: true, actor: true },
			fact: { id: true, kind: true, schema: true },
			role: { id: true, kind: true },
			decision: { id: true, kind: true, stage: true, role: true, actor: true, outcome: true },
			approval: { id: true, kind: true, role: true, actor: true },
			lookup: { id: true, kind: true, values: true }
		};
		for (const kind of NODE_KINDS) {
			expect([...$defs[`${kind}Core`].required].sort()).toEqual(Object.keys(required[kind]).sort());
		}
	});

	it('lists the same enumerations', () => {
		expect($defs.core.properties.kind.enum).toEqual([...NODE_KINDS]);
		expect($defs.actor.enum).toEqual([...ACTOR_POLICIES]);
		expect($defs.lookup.properties.kind.enum).toEqual([...LOOKUP_KINDS]);
		expect($defs.factSchema.properties['x-sensitivity'].enum).toEqual([...SENSITIVITY_LEVELS]);
		expect($defs.roleCore.properties.scope.enum).toEqual([...ROLE_SCOPES]);
		expect(schema.properties.schemaVersion.const).toBe(SCHEMA_VERSION);
	});

	it('is a JSON Schema 2020-12 document versioned with the types', () => {
		expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
		expect(schema.$id).toBe(`urn:casebook:schema:process-definition:v${SCHEMA_VERSION}`);
	});
});
