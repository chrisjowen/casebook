/**
 * Guard expressions as a person builds and reads them (ADR 0004): rows of "fact, operator, value"
 * joined by "all of" or "any of", and a plain-English line such as "Severity is SEV1 or SEV2".
 *
 * The stored format stays the expression text. `toCondition` reads an expression into rows when
 * every part of it has one, `fromCondition` writes rows back as an expression, and
 * `describeGuard` words any expression, including ones written by hand that have no rows.
 */
import type { FactSchema } from './node.js';
import { flatten, parseGuard, type GuardAst } from './runtime/expression.js';

/** What kind of value a fact holds, as far as choosing operators and values goes. */
export type ConditionKind =
	| 'text'
	| 'choice'
	| 'lookup'
	| 'number'
	| 'yesno'
	| 'date'
	| 'people'
	| 'list'
	| 'document'
	| 'record';

/** A fact's condition kind, from its JSON Schema and casebook extensions (ADR 0006). */
export function conditionKind(schema: FactSchema | undefined): ConditionKind {
	if (!schema) return 'text';
	const lookup = schema['x-lookup'];
	if (schema['x-evidence']) return 'document';
	if (lookup?.kind === 'principal') return 'people';
	if (Array.isArray(schema.enum)) return 'choice';
	if (schema.format === 'date' || schema.format === 'date-time') return 'date';
	if (lookup) return 'lookup';
	switch (schema.type) {
		case 'number':
		case 'integer':
			return 'number';
		case 'boolean':
			return 'yesno';
		case 'array':
			return 'list';
		case 'object':
			return 'record';
		default:
			return 'text';
	}
}

/** What a rule asks of its fact. */
export type RuleOp =
	| 'is'
	| 'is-not'
	| 'one-of'
	| 'not-one-of'
	| 'gt'
	| 'gte'
	| 'lt'
	| 'lte'
	| 'set'
	| 'empty'
	| 'contains'
	| 'not-contains'
	| 'more-days-ago'
	| 'fewer-days-ago'
	| 'at-least'
	| 'at-most';

/** A value in a rule: a literal, or today's date. */
export type RuleValue = string | number | boolean | null | { today: true };

export interface Rule {
	kind: 'rule';
	/** The fact reference, such as `fact.severity` or `fact.address.city`. */
	fact: string;
	op: RuleOp;
	/** A list for `one-of` and `not-one-of`, a number of days or items for the counting operators. */
	value?: RuleValue | RuleValue[];
}

export interface Group {
	kind: 'group';
	/** `all`: every item must hold; `any`: at least one must. */
	join: 'all' | 'any';
	items: (Rule | Group)[];
}

export type Condition = Rule | Group;

const OPS: Record<ConditionKind, RuleOp[]> = {
	text: ['is', 'is-not', 'one-of', 'not-one-of', 'contains', 'not-contains', 'set', 'empty'],
	choice: ['is', 'is-not', 'one-of', 'not-one-of', 'set', 'empty'],
	lookup: ['is', 'is-not', 'one-of', 'not-one-of', 'set', 'empty'],
	number: ['is', 'is-not', 'gt', 'gte', 'lt', 'lte', 'set', 'empty'],
	yesno: ['is', 'set', 'empty'],
	date: ['is', 'lt', 'gt', 'lte', 'gte', 'more-days-ago', 'fewer-days-ago', 'set', 'empty'],
	people: ['contains', 'not-contains', 'at-least', 'at-most', 'set', 'empty'],
	list: ['contains', 'not-contains', 'at-least', 'at-most', 'set', 'empty'],
	document: ['set', 'empty'],
	record: ['set', 'empty']
};

/** The operators that fit a kind of fact, in the order a picker lists them. */
export function operatorsFor(kind: ConditionKind): RuleOp[] {
	return OPS[kind];
}

/** An operator in words for a kind of fact: "is before" for a date, "is more than" for a number. */
export function operatorLabel(op: RuleOp, kind: ConditionKind): string {
	const date = kind === 'date';
	const list = kind === 'people' || kind === 'list';
	switch (op) {
		case 'is':
			return date ? 'is on' : 'is';
		case 'is-not':
			return 'is not';
		case 'one-of':
			return 'is one of';
		case 'not-one-of':
			return 'is none of';
		case 'gt':
			return date ? 'is after' : 'is more than';
		case 'gte':
			return date ? 'is on or after' : 'is at least';
		case 'lt':
			return date ? 'is before' : 'is less than';
		case 'lte':
			return date ? 'is on or before' : 'is at most';
		case 'set':
			return 'has a value';
		case 'empty':
			return 'is empty';
		case 'contains':
			return list ? 'includes' : 'contains';
		case 'not-contains':
			return list ? 'does not include' : 'does not contain';
		case 'more-days-ago':
			return 'is more than … days ago';
		case 'fewer-days-ago':
			return 'is less than … days ago';
		case 'at-least':
			return 'has at least';
		case 'at-most':
			return 'has at most';
	}
}

/** What sort of value an operator takes: none, one, a list, or a count. */
export function operandOf(op: RuleOp): 'none' | 'one' | 'many' | 'count' {
	switch (op) {
		case 'set':
		case 'empty':
			return 'none';
		case 'one-of':
		case 'not-one-of':
			return 'many';
		case 'more-days-ago':
		case 'fewer-days-ago':
		case 'at-least':
		case 'at-most':
			return 'count';
		default:
			return 'one';
	}
}

/** True when a rule has everything it needs to be written as an expression. */
export function isComplete(rule: Rule): boolean {
	if (!/^fact\.\w/.test(rule.fact)) return false;
	const operand = operandOf(rule.op);
	if (operand === 'none') return true;
	if (operand === 'many') return Array.isArray(rule.value) && rule.value.length > 0;
	if (operand === 'count') return typeof rule.value === 'number' && Number.isFinite(rule.value);
	return rule.value !== undefined && !Array.isArray(rule.value) && rule.value !== '';
}

// ---------------------------------------------------------------------------
// Rows from an expression
// ---------------------------------------------------------------------------

/**
 * Reads an expression into a group of rules, or undefined when it does not parse or has a part
 * the rows cannot show, such as `not (a or b)`. A single rule comes back as a group of one.
 */
export function toCondition(expr: string): Group | undefined {
	let ast: GuardAst;
	try {
		ast = parseGuard(expr);
	} catch {
		return undefined;
	}
	const read = conditionOf(ast);
	if (!read) return undefined;
	return read.kind === 'group' ? read : { kind: 'group', join: 'all', items: [read] };
}

function conditionOf(ast: GuardAst): Condition | undefined {
	if (ast.kind === 'logic') {
		const items = flatten(ast).map(conditionOf);
		if (items.some((i) => !i)) return undefined;
		return { kind: 'group', join: ast.op === '&&' ? 'all' : 'any', items: items as Condition[] };
	}
	return ruleOf(ast);
}

const FLIPPED: Record<string, string> = { '<': '>', '<=': '>=', '>': '<', '>=': '<=' };
const COMPARE_OP: Record<string, RuleOp> = {
	'==': 'is',
	'!=': 'is-not',
	'>': 'gt',
	'>=': 'gte',
	'<': 'lt',
	'<=': 'lte'
};

/** The rule an expression part is, when it is one; exported for wording test results. */
export function ruleOf(ast: GuardAst): Rule | undefined {
	if (ast.kind === 'not') {
		const inner = ruleOf(ast.operand);
		if (inner?.op === 'one-of') return { ...inner, op: 'not-one-of' };
		if (inner?.op === 'contains') return { ...inner, op: 'not-contains' };
		return undefined;
	}
	if (ast.kind === 'call') {
		const [target, value] = ast.args;
		const fact = target && refText(target);
		if (!fact) return undefined;
		if (ast.name === 'is_set') return { kind: 'rule', fact, op: 'set' };
		if (ast.name === 'is_empty') return { kind: 'rule', fact, op: 'empty' };
		const v = value && valueOf(value);
		if (ast.name === 'contains' && v !== undefined && !Array.isArray(v)) {
			return { kind: 'rule', fact, op: 'contains', value: v };
		}
		return undefined;
	}
	if (ast.kind !== 'compare') return undefined;
	let { left, right, op } = ast;
	if (!refText(left) && left.kind !== 'call' && (refText(right) || right.kind === 'call')) {
		[left, right] = [right, left];
		op = FLIPPED[op] ?? op;
	}
	// days_since(fact.x) > 3, count(fact.x) >= 2
	if (left.kind === 'call' && left.args.length === 1) {
		const fact = refText(left.args[0]!);
		const n = right.kind === 'literal' && typeof right.value === 'number' ? right.value : undefined;
		if (!fact || n === undefined) return undefined;
		if (left.name === 'days_since' && op === '>') {
			return { kind: 'rule', fact, op: 'more-days-ago', value: n };
		}
		if (left.name === 'days_since' && op === '<') {
			return { kind: 'rule', fact, op: 'fewer-days-ago', value: n };
		}
		if (left.name === 'count' && op === '>=')
			return { kind: 'rule', fact, op: 'at-least', value: n };
		if (left.name === 'count' && op === '<=')
			return { kind: 'rule', fact, op: 'at-most', value: n };
		return undefined;
	}
	const fact = refText(left);
	if (!fact) return undefined;
	if (op === 'in') {
		if (right.kind !== 'list') return undefined;
		const values = right.items.map(valueOf);
		if (values.some((v) => v === undefined || Array.isArray(v))) return undefined;
		return { kind: 'rule', fact, op: 'one-of', value: values as RuleValue[] };
	}
	const value = valueOf(right);
	if (value === undefined || Array.isArray(value)) return undefined;
	if (value === null && op === '==') return { kind: 'rule', fact, op: 'empty' };
	if (value === null && op === '!=') return { kind: 'rule', fact, op: 'set' };
	const ruleOp = COMPARE_OP[op];
	return ruleOp ? { kind: 'rule', fact, op: ruleOp, value } : undefined;
}

function refText(ast: GuardAst): string | undefined {
	return ast.kind === 'ref' ? [ast.fact, ...ast.path].join('.') : undefined;
}

function valueOf(ast: GuardAst): RuleValue | RuleValue[] | undefined {
	if (ast.kind === 'literal') {
		const v = ast.value;
		return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v === null
			? v
			: undefined;
	}
	if (ast.kind === 'call' && ast.name === 'today') return { today: true };
	return undefined;
}

// ---------------------------------------------------------------------------
// An expression from rows
// ---------------------------------------------------------------------------

/**
 * Writes a group of rules as an expression. Rules still missing a fact or a value are left out;
 * undefined when nothing is left.
 */
export function fromCondition(condition: Condition): string | undefined {
	return write(condition, true);
}

function write(c: Condition, top: boolean): string | undefined {
	if (c.kind === 'rule') return isComplete(c) ? writeRule(c) : undefined;
	const parts = c.items.map((i) => write(i, false)).filter((p): p is string => p !== undefined);
	if (parts.length === 0) return undefined;
	if (parts.length === 1) return parts[0];
	const joined = parts.join(c.join === 'all' ? ' and ' : ' or ');
	return top ? joined : `(${joined})`;
}

function writeRule(r: Rule): string {
	const one = () => literal(r.value as RuleValue);
	switch (r.op) {
		case 'is':
			return `${r.fact} == ${one()}`;
		case 'is-not':
			return `${r.fact} != ${one()}`;
		case 'gt':
			return `${r.fact} > ${one()}`;
		case 'gte':
			return `${r.fact} >= ${one()}`;
		case 'lt':
			return `${r.fact} < ${one()}`;
		case 'lte':
			return `${r.fact} <= ${one()}`;
		case 'one-of':
			return `${r.fact} in [${(r.value as RuleValue[]).map(literal).join(', ')}]`;
		case 'not-one-of':
			return `not (${r.fact} in [${(r.value as RuleValue[]).map(literal).join(', ')}])`;
		case 'set':
			return `${r.fact} != null`;
		case 'empty':
			return `${r.fact} == null`;
		case 'contains':
			return `contains(${r.fact}, ${one()})`;
		case 'not-contains':
			return `not contains(${r.fact}, ${one()})`;
		case 'more-days-ago':
			return `days_since(${r.fact}) > ${one()}`;
		case 'fewer-days-ago':
			return `days_since(${r.fact}) < ${one()}`;
		case 'at-least':
			return `count(${r.fact}) >= ${one()}`;
		case 'at-most':
			return `count(${r.fact}) <= ${one()}`;
	}
}

/** A value as the expression language writes it. */
export function literal(value: RuleValue): string {
	if (value !== null && typeof value === 'object') return 'today()';
	if (typeof value === 'string')
		return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
	return String(value);
}

// ---------------------------------------------------------------------------
// Plain English
// ---------------------------------------------------------------------------

/** How a fact reads in a sentence: its plain name and kind. */
export type FactInfo = (fact: string) => { name: string; kind: ConditionKind };

/** An expression in plain English, or undefined when it does not parse. */
export function describeGuard(expr: string, info: FactInfo): string | undefined {
	try {
		return describeAst(parseGuard(expr), info);
	} catch {
		return undefined;
	}
}

/** A rule in plain English: "Severity is SEV1 or SEV2". */
export function describeRule(rule: Rule, info: FactInfo): string {
	const { name, kind } = info(rule.fact);
	const v = (value: unknown) => describeLiteral(value, kind);
	const many = () => orList(((rule.value as RuleValue[] | undefined) ?? []).map(v));
	const n = rule.value as number;
	switch (rule.op) {
		case 'one-of':
			return `${name} is ${many()}`;
		case 'not-one-of':
			return `${name} is not ${many()}`;
		case 'set':
		case 'empty':
			return `${name} ${operatorLabel(rule.op, kind)}`;
		case 'more-days-ago':
			return `${name} is more than ${plural(n, 'day')} ago`;
		case 'fewer-days-ago':
			return `${name} is less than ${plural(n, 'day')} ago`;
		case 'at-least':
		case 'at-most':
			return `${name} ${operatorLabel(rule.op, kind)} ${n}`;
		default:
			return `${name} ${operatorLabel(rule.op, kind)} ${v(rule.value)}`;
	}
}

/** Any expression part in plain English. */
export function describeAst(ast: GuardAst, info: FactInfo): string {
	const rule = ruleOf(ast);
	if (rule) return describeRule(rule, info);
	switch (ast.kind) {
		case 'logic':
			return flatten(ast)
				.map((part) => {
					const text = describeAst(part, info);
					return part.kind === 'logic' ? `(${text})` : text;
				})
				.join(ast.op === '&&' ? ' and ' : ' or ');
		case 'not': {
			const inner = describeAst(ast.operand, info);
			return ast.operand.kind === 'logic' ? `not (${inner})` : `not ${inner}`;
		}
		case 'compare': {
			const words: Record<string, string> = {
				'==': 'is',
				'!=': 'is not',
				'<': 'is less than',
				'<=': 'is at most',
				'>': 'is more than',
				'>=': 'is at least',
				in: 'is one of'
			};
			return `${term(ast.left, info)} ${words[ast.op] ?? ast.op} ${term(ast.right, info)}`;
		}
		case 'ref': {
			const { name, kind } = info(refText(ast)!);
			return kind === 'yesno' ? `${name} is Yes` : `${name} has a value`;
		}
		default:
			return term(ast, info);
	}
}

function term(ast: GuardAst, info: FactInfo): string {
	switch (ast.kind) {
		case 'literal':
			return describeLiteral(ast.value, 'text');
		case 'ref':
			return info(refText(ast)!).name;
		case 'role':
			return `the ${ast.role.slice('role.'.length).replaceAll('-', ' ')} role`;
		case 'list':
			return orList(ast.items.map((i) => term(i, info)));
		case 'call': {
			const [a, b] = ast.args.map((x) => term(x, info));
			switch (ast.name) {
				case 'today':
					return 'today';
				case 'days_since':
					return `days since ${a}`;
				case 'days_between':
					return `days from ${a} to ${b}`;
				case 'add_days':
					return `${b} days after ${a}`;
				case 'count':
					return `the number of ${a}`;
				case 'contains':
					return `${a} contains ${b}`;
				case 'is_set':
					return `${a} has a value`;
				case 'is_empty':
					return `${a} is empty`;
				default:
					return `${ast.name}(${[a, b].filter(Boolean).join(', ')})`;
			}
		}
		default:
			return describeAst(ast, info);
	}
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A value as a sentence shows it: Yes or No, "15 Jan 2026", a quoted text, or a choice as is. */
export function describeLiteral(value: unknown, kind: ConditionKind): string {
	if (value === null || value === undefined) return 'nothing';
	if (typeof value === 'object' && !Array.isArray(value)) return 'today';
	if (typeof value === 'boolean') return value ? 'Yes' : 'No';
	if (typeof value === 'number') return String(value);
	if (Array.isArray(value)) return orList(value.map((v) => describeLiteral(v, kind)));
	const text = String(value);
	const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
	if (date) return `${Number(date[3])} ${MONTHS[Number(date[2]) - 1]} ${date[1]}`;
	return kind === 'text' ? `“${text}”` : text;
}

function orList(items: string[]): string {
	if (items.length <= 1) return items[0] ?? 'nothing';
	return `${items.slice(0, -1).join(', ')} or ${items.at(-1)}`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
