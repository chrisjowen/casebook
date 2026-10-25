import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import type { FactNode, FactSchema } from '../node.js';

/**
 * Reading and checking fact values (ADR 0006). Forms send text; `readFactInput` turns it into a
 * value of the fact's type, and `factValueProblem` checks a value against the fact's schema.
 */

/** A file stored for a case, as a fact value refers to it: `casebook:file/<id>`. */
export const FILE_REFERENCE = /^casebook:file\/([0-9a-f-]{36})$/;

export const fileReference = (fileId: string) => `casebook:file/${fileId}`;

/** The file id in a fact value that refers to a stored file, if it is one. */
export function referencedFile(value: unknown): string | undefined {
	return typeof value === 'string' ? FILE_REFERENCE.exec(value)?.[1] : undefined;
}

/** True when the fact's value is the evidence file itself, such as a signed form or an RCA. */
export function isFileFact(schema: FactSchema): boolean {
	return schema['x-evidence'] !== undefined && schema.type === 'string' && schema.format === 'uri';
}

export type FactInput = { ok: true; value: unknown } | { ok: false; problem: string };

const typeOf = (schema: FactSchema) => (typeof schema.type === 'string' ? schema.type : undefined);

/**
 * Reads what a form sent for a fact into a value of its type: `yes`/`no` or `true`/`false` for a
 * boolean, a number for a number, and for a list, one entry per field or per line. Returns a
 * missing value (undefined) when nothing was entered.
 */
export function readFactInput(schema: FactSchema, raw: readonly string[]): FactInput {
	const entries = raw.map((r) => r.trim()).filter((r) => r !== '');
	if (entries.length === 0) return { ok: true, value: undefined };
	const first = entries[0]!;
	switch (typeOf(schema)) {
		case 'boolean': {
			const v = first.toLowerCase();
			if (v === 'true' || v === 'yes') return { ok: true, value: true };
			if (v === 'false' || v === 'no') return { ok: true, value: false };
			return { ok: false, problem: 'choose yes or no' };
		}
		case 'number':
		case 'integer': {
			const n = Number(first.replace(/[\s,_€$£]/g, ''));
			if (!Number.isFinite(n)) return { ok: false, problem: `"${first}" is not a number` };
			return { ok: true, value: n };
		}
		case 'array': {
			const items = entries.flatMap((e) => e.split(/\r?\n/)).map((e) => e.trim());
			const itemSchema = (schema.items ?? {}) as FactSchema;
			const values: unknown[] = [];
			for (const item of items.filter((e) => e !== '')) {
				const read = readFactInput(itemSchema, [item]);
				if (!read.ok) return read;
				values.push(read.value);
			}
			return { ok: true, value: values };
		}
		case 'object':
			try {
				return { ok: true, value: JSON.parse(first) };
			} catch {
				return { ok: false, problem: 'enter the value as JSON' };
			}
		default:
			return { ok: true, value: first };
	}
}

// Fact schemas carry casebook's `x-` keywords, so strict mode is off; formats are checked below.
const ajv = new Ajv2020({ strict: false, validateFormats: false, allErrors: false });
const compiled = new Map<string, ValidateFunction>();

const FORMATS: Record<string, (value: string) => boolean> = {
	date: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)),
	'date-time': (v) => /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v)),
	uri: (v) => /^[a-z][a-z0-9+.-]*:\S+$/i.test(v)
};

const FORMAT_WORDS: Record<string, string> = {
	date: 'a date such as 2026-01-15',
	'date-time': 'a date and time',
	uri: 'a link or an attached file'
};

/**
 * Explains why `value` is not a valid value of the fact, or returns undefined when it is. The
 * message names the fact by its title.
 */
export function factValueProblem(fact: FactNode, value: unknown): string | undefined {
	const { schema } = fact.core;
	const name = fact.core.title ?? fact.core.id;
	const key = JSON.stringify(schema);
	let validate = compiled.get(key);
	if (!validate) {
		validate = ajv.compile(schema);
		compiled.set(key, validate);
	}
	if (!validate(value)) return `${name}: ${describe(validate.errors?.[0], schema)}`;
	const format = formatProblem(schema, value);
	return format && `${name}: ${format}`;
}

function formatProblem(schema: FactSchema, value: unknown): string | undefined {
	if (typeof value === 'string' && typeof schema.format === 'string') {
		const check = FORMATS[schema.format];
		if (check && !check(value)) return `must be ${FORMAT_WORDS[schema.format]}`;
	}
	if (Array.isArray(value) && schema.items && typeof schema.items === 'object') {
		for (const item of value) {
			const problem = formatProblem(schema.items as FactSchema, item);
			if (problem) return problem;
		}
	}
	return undefined;
}

function describe(error: ErrorObject | undefined, schema: FactSchema): string {
	if (!error) return 'is not valid';
	const p = error.params as Record<string, unknown>;
	switch (error.keyword) {
		case 'enum':
			return `must be one of ${(p.allowedValues as unknown[]).join(', ')}`;
		case 'type':
			return `must be ${p.type === 'boolean' ? 'yes or no' : `a ${String(p.type)}`}`;
		case 'minLength':
			return 'cannot be empty';
		case 'pattern': {
			const example = Array.isArray(schema.examples) ? schema.examples[0] : undefined;
			return example === undefined
				? `does not match the expected format`
				: `does not match the expected format, such as ${JSON.stringify(example)}`;
		}
		case 'minItems':
			return `needs at least ${String(p.limit)}`;
		case 'maxItems':
			return `takes at most ${String(p.limit)}`;
		case 'minimum':
			return `must be at least ${String(p.limit)}`;
		case 'maximum':
			return `must be at most ${String(p.limit)}`;
		default:
			return error.message ?? 'is not valid';
	}
}
