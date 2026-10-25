import { Ajv2020, type ErrorObject } from 'ajv/dist/2020.js';
import definitionSchema from '../../schema/process-definition.schema.json' with { type: 'json' };
import {
	NODE_KINDS,
	type DecisionId,
	type Node,
	type NodeId,
	type RoleId,
	type StageId,
	type StepId
} from '../node.js';
import { formatField } from '../pointer.js';
import { isRecord } from './json.js';

/**
 * Typed node operations (ADR 0011): the one way the editor UI and the wizard agent change a draft.
 * Each has a JSON Schema in `OPERATION_SCHEMAS`, usable as an agent tool definition.
 */

/** Edges `link` and `unlink` manage. Other references are changed with `update_core`. */
export const EDGE_KINDS = ['requires', 'collects', 'approval', 'stage'] as const;

export type EdgeKind = (typeof EDGE_KINDS)[number];

/** Adds a node. It goes after the last node of the same kind, or at the end. */
export interface AddNode {
	op: 'add_node';
	node: Node;
}

/** Removes a node. Refused while any other node refers to it; nothing is unlinked implicitly. */
export interface RemoveNode {
	op: 'remove_node';
	id: NodeId;
}

/** Field changes to a node's core, as a JSON Merge Patch: `null` removes a field. */
export type CoreChanges = Record<string, unknown>;

/** Merges changes into a node's core (RFC 7386). The id and kind cannot change. */
export interface UpdateCore {
	op: 'update_core';
	id: NodeId;
	changes: CoreChanges;
}

/** Replaces a node's Markdown content; `null` or an empty string removes it. */
export interface SetContent {
	op: 'set_content';
	id: NodeId;
	content: string | null;
}

/** Sets one namespaced key in a node's data map, such as `ui.icon`; `null` removes it. */
export interface SetData {
	op: 'set_data';
	id: NodeId;
	key: string;
	value: unknown;
}

/**
 * Adds an edge from a node: `requires` and `collects` to a fact, `approval` from a step to an
 * approval, `stage` from a step or decision to a stage. `approval` and `stage` hold one target,
 * so linking replaces the current one. `by` names the role that records a collected fact.
 */
export interface Link {
	op: 'link';
	from: NodeId;
	edge: EdgeKind;
	to: NodeId;
	by?: RoleId;
}

/** Removes an edge. A stage edge cannot be removed, since every step and decision has a stage. */
export interface Unlink {
	op: 'unlink';
	from: NodeId;
	edge: EdgeKind;
	to: NodeId;
}

/** Moves a step or decision to another stage. */
export interface MoveToStage {
	op: 'move_to_stage';
	id: StepId | DecisionId;
	stage: StageId;
}

export type Operation =
	AddNode | RemoveNode | UpdateCore | SetContent | SetData | Link | Unlink | MoveToStage;

export type OperationName = Operation['op'];

export const OPERATION_NAMES = [
	'add_node',
	'remove_node',
	'update_core',
	'set_content',
	'set_data',
	'link',
	'unlink',
	'move_to_stage'
] as const satisfies readonly OperationName[];

type JsonSchema = Record<string, unknown>;

const { $defs: definitionDefs } = definitionSchema;
const DATA_KEY_PATTERN = definitionDefs.node.properties.data.propertyNames.pattern;
const NODE_ID_PATTERN = `^(${NODE_KINDS.join('|')})\\.[a-z0-9]+(-[a-z0-9]+)*$`;

const nodeId = (description: string) => ({ $ref: '#/$defs/nodeId', description });

function operationSchemas(node: JsonSchema): Record<OperationName, JsonSchema> {
	const defs: Record<string, unknown> = {
		...definitionDefs,
		nodeId: { type: 'string', pattern: NODE_ID_PATTERN }
	};
	const define = (
		op: OperationName,
		description: string,
		properties: Record<string, unknown>,
		optional: readonly string[] = []
	): JsonSchema => {
		const schema: JsonSchema = {
			$schema: 'https://json-schema.org/draft/2020-12/schema',
			title: op,
			description,
			type: 'object',
			required: ['op', ...Object.keys(properties).filter((key) => !optional.includes(key))],
			additionalProperties: false,
			properties: { op: { const: op }, ...properties }
		};
		const used = reachableDefs(properties, defs);
		if (used.length > 0) schema.$defs = Object.fromEntries(used.map((name) => [name, defs[name]]));
		return schema;
	};
	return {
		add_node: define(
			'add_node',
			'Add a node to the draft. Its id must be new and prefixed with its kind, such as step.notify-downstream.',
			{ node }
		),
		remove_node: define(
			'remove_node',
			'Remove a node. Refused while other nodes refer to it: change or unlink those references first.',
			{ id: nodeId('The node to remove.') }
		),
		update_core: define(
			'update_core',
			"Change fields of a node's core as a JSON Merge Patch: listed fields replace the current value, null removes an optional field, nested objects merge. id and kind cannot change.",
			{
				id: nodeId('The node to change.'),
				changes: {
					type: 'object',
					minProperties: 1,
					description: 'Core fields to set, such as {"title": "Classify severity"}.'
				}
			}
		),
		set_content: define(
			'set_content',
			"Replace a node's Markdown guidance for people. null or an empty string removes it.",
			{
				id: nodeId('The node to change.'),
				content: { type: ['string', 'null'] }
			}
		),
		set_data: define(
			'set_data',
			"Set one namespaced key in a node's data map, such as ui.icon. A null value removes the key.",
			{
				id: nodeId('The node to change.'),
				key: { type: 'string', pattern: DATA_KEY_PATTERN },
				value: { description: 'Any JSON value; null removes the key.' }
			}
		),
		link: define(
			'link',
			'Add an edge: requires (step, decision or approval to a fact), collects (step to a fact, optionally recorded by another role), approval (step to the approval it needs) or stage (step or decision to its stage). approval and stage replace the current target.',
			{
				from: nodeId('The node the edge starts from.'),
				edge: { enum: [...EDGE_KINDS] },
				to: nodeId('The node the edge points to.'),
				by: {
					$ref: '#/$defs/roleId',
					description: 'For collects only: the role that records the fact.'
				}
			},
			['by']
		),
		unlink: define(
			'unlink',
			'Remove an edge added by link. A stage edge cannot be removed; use move_to_stage.',
			{
				from: nodeId('The node the edge starts from.'),
				edge: { enum: [...EDGE_KINDS] },
				to: nodeId('The node the edge points to.')
			}
		),
		move_to_stage: define('move_to_stage', 'Move a step or decision to another stage.', {
			id: {
				type: 'string',
				pattern: '^(step|decision)\\.[a-z0-9]+(-[a-z0-9]+)*$',
				description: 'The step or decision to move.'
			},
			stage: { $ref: '#/$defs/stageId', description: 'The stage to move it to.' }
		})
	};
}

/** Lists the `$defs` that a schema fragment refers to, directly or through other definitions. */
function reachableDefs(fragment: unknown, defs: Record<string, unknown>): string[] {
	const found = new Set<string>();
	const visit = (value: unknown) => {
		if (Array.isArray(value)) {
			value.forEach(visit);
			return;
		}
		if (!isRecord(value)) return;
		for (const [key, child] of Object.entries(value)) {
			const match =
				key === '$ref' && typeof child === 'string' && /^#\/\$defs\/([^/]+)/.exec(child);
			if (match && match[1] !== undefined && !found.has(match[1])) {
				found.add(match[1]);
				visit(defs[match[1]]);
			}
			visit(child);
		}
	};
	visit(fragment);
	return [...found].sort();
}

/**
 * JSON Schema (2020-12) for each operation, with the full node shape for `add_node`. Self-contained,
 * so each can be handed to an agent as a tool's input schema.
 */
export const OPERATION_SCHEMAS = operationSchemas({ $ref: '#/$defs/node' });

/** A problem with the shape of an operation, before it is tried against a document. */
export interface OperationError {
	/** Readable location inside the operation, such as `edge`, or `operation` for the whole. */
	field: string;
	message: string;
}

export type OperationCheck =
	{ valid: true; operation: Operation } | { valid: false; errors: OperationError[] };

// Node shapes inside `add_node` are left to document validation, whose messages name the field.
const ajv = new Ajv2020({ allErrors: true, strictTypes: false });
const envelopes = new Map(
	Object.entries(operationSchemas({ type: 'object', required: ['core'] })).map(([op, schema]) => [
		op,
		ajv.compile(schema)
	])
);

/** Checks that a value has the shape of an operation. */
export function checkOperation(value: unknown): OperationCheck {
	const name = isRecord(value) ? value.op : undefined;
	const validator = typeof name === 'string' ? envelopes.get(name) : undefined;
	if (validator === undefined) {
		return {
			valid: false,
			errors: [
				{
					field: 'op',
					message: `op must be one of ${OPERATION_NAMES.join(', ')}`
				}
			]
		};
	}
	if (validator(value)) return { valid: true, operation: value as Operation };
	const errors = (validator.errors ?? []).map(describe);
	return {
		valid: false,
		errors: errors.filter((e, i) => errors.findIndex((o) => o.message === e.message) === i)
	};
}

function describe(error: ErrorObject): OperationError {
	const segments = error.instancePath.split('/').slice(1);
	const field = segments.length > 0 ? formatField(segments) : 'operation';
	const params = error.params as Record<string, unknown>;
	let problem: string;
	switch (error.keyword) {
		case 'required':
			problem = `is missing required field "${String(params.missingProperty)}"`;
			break;
		case 'additionalProperties':
			problem = `has unknown field "${String(params.additionalProperty)}"`;
			break;
		case 'enum':
			problem = `must be one of ${(params.allowedValues as unknown[]).map((v) => JSON.stringify(v)).join(', ')}`;
			break;
		case 'pattern':
			problem =
				params.pattern === DATA_KEY_PATTERN
					? 'must be a namespaced key, such as "ui.icon" or "hooks.on_completed"'
					: 'must be a node id: its kind, a dot, then lowercase words joined by hyphens, such as "step.notify-downstream"';
			break;
		case 'minProperties':
			problem = 'must list at least one field to change';
			break;
		default:
			problem = error.message ?? 'is not valid';
	}
	return { field, message: `${field} ${problem}` };
}
