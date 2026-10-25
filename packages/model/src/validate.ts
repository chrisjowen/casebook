import { Ajv2020, type ErrorObject } from 'ajv/dist/2020.js';
import schema from '../schema/process-definition.schema.json' with { type: 'json' };
import { NODE_KINDS, type DefinitionDocument } from './node.js';
import { formatField } from './pointer.js';

/** A schema violation, located by JSON Pointer and, inside a node, by node id and field. */
export interface ValidationError {
	/** JSON Pointer into the document, such as `/nodes/3/core/actor`. */
	path: string;
	/** Id of the node the error is in, when the path is inside a node that has a readable id. */
	nodeId?: string;
	/** Readable location, such as `core.collects[0].fact`, or `document` at the top level. */
	field: string;
	/** The JSON Schema keyword that failed. */
	keyword: string;
	/** Plain-language description of the problem, naming the field. */
	message: string;
}

export type ValidationResult =
	| { valid: true; document: DefinitionDocument; errors: [] }
	| { valid: false; errors: ValidationError[] };

const ajv = new Ajv2020({ allErrors: true, strictTypes: false });
const validateSchema = ajv.compile<DefinitionDocument>(schema);

const { $defs } = schema;
const PATTERN_DESCRIPTIONS = new Map<string, string>([
	...NODE_KINDS.map((kind): [string, string] => [
		$defs[`${kind}Id`].pattern,
		`a ${kind} id: "${kind}." followed by lowercase words joined by hyphens`
	]),
	[$defs.kebab.pattern, 'lowercase words joined by hyphens, such as "incident-management"'],
	[schema.properties.namespace.pattern, 'a namespace path such as "acme/eng/sre"'],
	[
		$defs.stepCore.properties.repeat.properties.every.pattern,
		'an ISO 8601 duration such as "PT30M"'
	]
]);

/**
 * Validates a process-definition document against the process-definition JSON Schema.
 * Errors are plain language and point at the node and field at fault.
 */
export function validate(document: unknown): ValidationResult {
	if (validateSchema(document)) {
		return { valid: true, document, errors: [] };
	}
	return { valid: false, errors: describeErrors(document, validateSchema.errors ?? []) };
}

function describeErrors(document: unknown, raw: ErrorObject[]): ValidationError[] {
	// `if` failures only say which branch applied, and a property-name pattern failure repeats its
	// `propertyNames` error, so both are noise. When `anyOf` fails, the failures of its
	// alternatives at the same place are merged into one "this, or that" message.
	const isChoice = (e: ErrorObject) => e.keyword === 'anyOf' || e.keyword === 'oneOf';
	const specific = raw.filter(
		(e) =>
			e.keyword !== 'if' &&
			!isChoice(e) &&
			!(e.keyword === 'pattern' && e.propertyName !== undefined)
	);
	const choicePaths = new Set(raw.filter(isChoice).map((e) => e.instancePath));

	const seen = new Set<string>();
	const errors: ValidationError[] = [];
	const add = (error: ValidationError) => {
		const key = `${error.path}\n${error.message}`;
		if (!seen.has(key)) {
			seen.add(key);
			errors.push(error);
		}
	};
	for (const path of choicePaths) {
		const alternatives = specific.filter((e) => e.instancePath === path);
		const choice = raw.find((e) => isChoice(e) && e.instancePath === path);
		if (alternatives.length === 0 && choice !== undefined) {
			add(describe(document, choice, problem(choice)));
		} else if (alternatives[0] !== undefined) {
			const merged = [...new Set(alternatives.map(problem))].join(', or ');
			add(describe(document, alternatives[0], merged));
		}
	}
	for (const error of specific) {
		if (!choicePaths.has(error.instancePath)) add(describe(document, error, problem(error)));
	}
	return errors.sort((a, b) => a.path.localeCompare(b.path, 'en', { numeric: true }));
}

function describe(document: unknown, error: ErrorObject, text: string): ValidationError {
	const segments = error.instancePath
		.split('/')
		.slice(1)
		.map((s) => s.replaceAll('~1', '/').replaceAll('~0', '~'));
	const nodeId = nodeIdAt(document, segments);
	const inNode = segments[0] === 'nodes' && segments.length >= 2;
	const fieldSegments = inNode ? segments.slice(2) : segments;
	const field =
		fieldSegments.length > 0 ? formatField(fieldSegments) : inNode ? 'node' : 'document';
	const result: ValidationError = {
		path: error.instancePath,
		field,
		keyword: error.keyword,
		message: `${field} ${text}`
	};
	if (inNode && nodeId === undefined) {
		result.message = `node ${segments[1]}: ${result.message}`;
	}
	if (nodeId !== undefined) {
		result.nodeId = nodeId;
	}
	return result;
}

function problem(error: ErrorObject): string {
	const params = error.params as Record<string, unknown>;
	switch (error.keyword) {
		case 'required':
			return `is missing required field "${String(params.missingProperty)}"`;
		case 'additionalProperties':
			return `has unknown field "${String(params.additionalProperty)}"`;
		case 'propertyNames':
			return `key "${String(params.propertyName)}" must be namespaced, such as "ui.icon" or "hooks.on_completed"`;
		case 'enum':
			return `must be one of ${listValues(params.allowedValues as unknown[])}`;
		case 'const':
			return `must be ${JSON.stringify(params.allowedValue)}`;
		case 'type':
			return `must be ${withArticle(String(params.type))}`;
		case 'pattern': {
			const pattern = String(params.pattern);
			return `must be ${PATTERN_DESCRIPTIONS.get(pattern) ?? `text matching ${pattern}`}`;
		}
		case 'minLength':
			return params.limit === 1
				? 'must not be empty'
				: `must be at least ${String(params.limit)} characters long`;
		case 'minItems':
			return `must have at least ${String(params.limit)} item${params.limit === 1 ? '' : 's'}`;
		case 'uniqueItems':
			return `lists the same value twice (items ${String(params.j)} and ${String(params.i)})`;
		case 'minimum':
			return `must be at least ${String(params.limit)}`;
		case 'anyOf':
		case 'oneOf':
			return 'does not match any of the allowed forms';
		default:
			return error.message ?? 'is not valid';
	}
}

function nodeIdAt(document: unknown, segments: string[]): string | undefined {
	if (segments[0] !== 'nodes' || segments[1] === undefined || !isRecord(document)) {
		return undefined;
	}
	const nodes = document.nodes;
	const node = Array.isArray(nodes) ? (nodes[Number(segments[1])] as unknown) : undefined;
	const core = isRecord(node) ? node.core : undefined;
	const id = isRecord(core) ? core.id : undefined;
	return typeof id === 'string' && id.length > 0 ? id : undefined;
}

function listValues(values: unknown[]): string {
	const quoted = values.map((v) => JSON.stringify(v));
	return quoted.length <= 1
		? (quoted[0] ?? 'nothing')
		: `${quoted.slice(0, -1).join(', ')} or ${quoted.at(-1)}`;
}

function withArticle(type: string): string {
	const readable = type.replaceAll(',', ' or ');
	return /^[aeiou]/.test(readable) ? `an ${readable}` : `a ${readable}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
