/**
 * Evaluates guard expressions over a case's facts (ADR 0004).
 *
 * The language is deliberately small and sandboxed: literals (`true`, `false`, `null`, numbers,
 * quoted strings and `[...]` lists), fact references such as `fact.severity` or
 * `fact.address.city`, comparisons (`==`, `!=`, `<`, `<=`, `>`, `>=`, `in`), `!`/`not`,
 * `&&`/`and`, `||`/`or`, parentheses and the helper functions in `GUARD_HELPERS`, such as
 * `days_since(fact.reported-at) > 3`. Nothing else is evaluated, so an expression can never call
 * code or reach outside the facts it is given.
 *
 * A fact that has not been recorded yet is unknown, and the answer may be unknown too. Logic is
 * three-valued: `false && unknown` is false, `true || unknown` is true. Comparing with `null` is
 * always known, because a missing fact counts as null there, which is how `until` conditions
 * such as `fact.resolved-at != null` are written; `is_set` and `is_empty` are always known too.
 */

/** True, false, or undefined when it depends on facts nobody has recorded yet. */
export type GuardValue = boolean | undefined;

/**
 * An expression that does not parse, or cannot be evaluated over the facts it is given; the
 * engine treats its guard as prose only. `at` is where in the expression the problem is, when
 * that is known.
 */
export class GuardSyntaxError extends Error {
	override readonly name = 'GuardSyntaxError';
	constructor(
		message: string,
		readonly at?: number
	) {
		super(message);
	}
}

/** Where a part of an expression sits in its text: `[start, end)`. */
export type Span = readonly [number, number];

/** A parsed guard expression. Every node carries the span of the text it was read from. */
export type GuardAst = { span: Span } & (
	| { kind: 'literal'; value: unknown }
	| { kind: 'ref'; fact: string; path: string[] }
	| { kind: 'role'; role: string }
	| { kind: 'list'; items: GuardAst[] }
	| { kind: 'call'; name: string; args: GuardAst[] }
	| { kind: 'not'; operand: GuardAst }
	| { kind: 'logic'; op: '&&' | '||'; left: GuardAst; right: GuardAst }
	| { kind: 'compare'; op: string; left: GuardAst; right: GuardAst }
);

/** Options for evaluating a guard. */
export interface GuardOptions {
	/** The moment `today()` and `days_since` read; now when absent. */
	now?: Date;
}

/** A helper function a guard can call, as autocomplete and the docs present it. */
export interface GuardHelper {
	name: string;
	/** How it is called, such as `days_since(date)`. */
	signature: string;
	/** One plain sentence on what it gives back. */
	description: string;
	/** An example a person could copy. */
	example: string;
	arity: number;
}

/** The helper functions guards can call, in the order they are documented. */
export const GUARD_HELPERS: readonly GuardHelper[] = [
	{
		name: 'today',
		signature: 'today()',
		description: "Today's date, such as 2026-10-26.",
		example: 'fact.due-date < today()',
		arity: 0
	},
	{
		name: 'days_since',
		signature: 'days_since(date)',
		description: 'Whole days from a date until today; negative for a date still to come.',
		example: 'days_since(fact.reported-at) > 3',
		arity: 1
	},
	{
		name: 'days_between',
		signature: 'days_between(from, to)',
		description: 'Whole days from one date to another.',
		example: 'days_between(fact.opened-at, fact.closed-at) <= 30',
		arity: 2
	},
	{
		name: 'add_days',
		signature: 'add_days(date, days)',
		description: 'The date a number of days after another; use a negative number for before.',
		example: 'fact.due-date < add_days(today(), 7)',
		arity: 2
	},
	{
		name: 'contains',
		signature: 'contains(list or text, value)',
		description: 'Whether a list holds a value, or a text holds another text, ignoring case.',
		example: "contains(fact.affected-teams, 'Payments')",
		arity: 2
	},
	{
		name: 'count',
		signature: 'count(list)',
		description: 'How many items a list has; nothing recorded counts as none.',
		example: 'count(fact.witnesses) >= 2',
		arity: 1
	},
	{
		name: 'is_set',
		signature: 'is_set(value)',
		description: 'Whether something is recorded and not empty.',
		example: 'is_set(fact.resolved-at)',
		arity: 1
	},
	{
		name: 'is_empty',
		signature: 'is_empty(value)',
		description: 'Whether nothing, or only an empty text or list, is recorded.',
		example: 'is_empty(fact.reference-number)',
		arity: 1
	}
];

const HELPERS = new Map(GUARD_HELPERS.map((h) => [h.name, h]));

/** Comparison operators, as written in code. */
export const GUARD_COMPARISONS = ['==', '!=', '<', '<=', '>', '>=', 'in'] as const;

type Token = { at: number; end: number } & (
	| { kind: 'literal'; value: unknown }
	| { kind: 'ref'; path: string[] }
	| { kind: 'name'; value: string }
	| { kind: 'op'; value: string }
);

const COMPARISONS: ReadonlySet<string> = new Set(GUARD_COMPARISONS);
const WORDS: Record<string, Pick<Token & { kind: 'literal' | 'op' }, 'kind' | 'value'>> = {
	true: { kind: 'literal', value: true },
	false: { kind: 'literal', value: false },
	null: { kind: 'literal', value: null },
	and: { kind: 'op', value: '&&' },
	or: { kind: 'op', value: '||' },
	not: { kind: 'op', value: '!' },
	in: { kind: 'op', value: 'in' }
};

function tokenize(expr: string): Token[] {
	const tokens: Token[] = [];
	let i = 0;
	while (i < expr.length) {
		const rest = expr.slice(i);
		const space = /^\s+/.exec(rest);
		if (space) {
			i += space[0].length;
			continue;
		}
		const at = i;
		const quoted = /^'((?:[^'\\]|\\.)*)'|^"((?:[^"\\]|\\.)*)"/.exec(rest);
		if (quoted) {
			const body = quoted[1] ?? quoted[2] ?? '';
			i += quoted[0].length;
			tokens.push({ kind: 'literal', value: body.replace(/\\(.)/g, '$1'), at, end: i });
			continue;
		}
		if (rest[0] === "'" || rest[0] === '"') {
			throw new GuardSyntaxError(`the text starting at position ${at} has no closing quote`, at);
		}
		const number = /^-?\d+(?:\.\d+)?/.exec(rest);
		if (number) {
			i += number[0].length;
			tokens.push({ kind: 'literal', value: Number(number[0]), at, end: i });
			continue;
		}
		const ref = /^(?:fact|role)\.\w+(?:-\w+)*(?:\.\w+(?:-\w+)*)*/.exec(rest);
		if (ref) {
			i += ref[0].length;
			tokens.push({ kind: 'ref', path: ref[0].split('.'), at, end: i });
			continue;
		}
		const word = /^[A-Za-z_]\w*/.exec(rest);
		if (word) {
			i += word[0].length;
			const known = WORDS[word[0]];
			if (known) tokens.push({ ...known, at, end: i } as Token);
			else if (HELPERS.has(word[0])) tokens.push({ kind: 'name', value: word[0], at, end: i });
			else {
				throw new GuardSyntaxError(
					`"${word[0]}" is not a fact, helper or word a condition can use`,
					at
				);
			}
			continue;
		}
		const op = /^(?:==|!=|<=|>=|&&|\|\||[<>!()[\],])/.exec(rest);
		if (op) {
			i += op[0].length;
			tokens.push({ kind: 'op', value: op[0], at, end: i });
			continue;
		}
		throw new GuardSyntaxError(`unexpected "${rest[0]}" at position ${at}`, at);
	}
	return tokens;
}

/** Parses a guard expression, or throws a GuardSyntaxError explaining what is wrong and where. */
export function parseGuard(expr: string): GuardAst {
	const tokens = tokenize(expr);
	let at = 0;
	const peek = () => tokens[at];
	const isOp = (value: string) => {
		const t = peek();
		return t?.kind === 'op' && t.value === value;
	};
	const where = () => peek()?.at ?? expr.trimEnd().length;
	const expect = (value: string) => {
		if (!isOp(value)) throw new GuardSyntaxError(`expected "${value}"`, where());
		return tokens[at++]!.end;
	};
	const span = (start: number, end: number): Span => [start, end];

	const primary = (): GuardAst => {
		const t = tokens[at++];
		if (!t) throw new GuardSyntaxError('the expression ends too early', expr.trimEnd().length);
		if (t.kind === 'literal') return { kind: 'literal', value: t.value, span: span(t.at, t.end) };
		if (t.kind === 'ref') {
			const [head, name, ...path] = t.path;
			const id = `${head}.${name}`;
			return head === 'role'
				? { kind: 'role', role: id, span: span(t.at, t.end) }
				: { kind: 'ref', fact: id, path, span: span(t.at, t.end) };
		}
		if (t.kind === 'name') {
			const helper = HELPERS.get(t.value)!;
			if (!isOp('(')) {
				throw new GuardSyntaxError(`${t.value} needs brackets: ${helper.signature}`, t.end);
			}
			at++;
			const args = isOp(')') ? [] : listOf(')');
			const end = expect(')');
			if (args.length !== helper.arity) {
				const n = helper.arity;
				throw new GuardSyntaxError(
					`${t.value} takes ${n === 0 ? 'nothing' : n === 1 ? 'one value' : `${n} values`}: ${helper.signature}`,
					t.at
				);
			}
			return { kind: 'call', name: t.value, args, span: span(t.at, end) };
		}
		if (t.value === '(') {
			const inner = or();
			expect(')');
			return inner;
		}
		if (t.value === '[') {
			const items = isOp(']') ? [] : listOf(']');
			const end = expect(']');
			return { kind: 'list', items, span: span(t.at, end) };
		}
		throw new GuardSyntaxError(`unexpected "${t.value}"`, t.at);
	};
	const listOf = (close: string): GuardAst[] => {
		const items = [or()];
		while (isOp(',')) {
			at++;
			if (isOp(close)) break;
			items.push(or());
		}
		return items;
	};
	const comparison = (): GuardAst => {
		const left = primary();
		const t = peek();
		if (t?.kind === 'op' && COMPARISONS.has(t.value)) {
			at++;
			const right = primary();
			return { kind: 'compare', op: t.value, left, right, span: span(left.span[0], right.span[1]) };
		}
		return left;
	};
	const not = (): GuardAst => {
		if (isOp('!')) {
			const start = tokens[at++]!.at;
			const operand = not();
			return { kind: 'not', operand, span: span(start, operand.span[1]) };
		}
		return comparison();
	};
	const chain = (op: '&&' | '||', next: () => GuardAst) => (): GuardAst => {
		let left = next();
		while (isOp(op)) {
			at++;
			const right = next();
			left = { kind: 'logic', op, left, right, span: span(left.span[0], right.span[1]) };
		}
		return left;
	};
	const and = chain('&&', not);
	const or = chain('||', and);

	if (tokens.length === 0) throw new GuardSyntaxError('the expression is empty', 0);
	const ast = or();
	if (at < tokens.length) {
		throw new GuardSyntaxError('there is more after the end of the expression', where());
	}
	return ast;
}

/** Facts as a guard reads them: the current value of each recorded fact, by fact id. */
export type GuardFacts = Readonly<Record<string, unknown>>;

const UNKNOWN = Symbol('unknown');
type Value = unknown;

interface Scope {
	facts: GuardFacts;
	now: Date;
}

/**
 * Evaluates a guard expression over the recorded facts. Returns undefined when the answer depends
 * on a fact that is not recorded yet. Throws a GuardSyntaxError for an expression that does not
 * parse, one that uses role references, which need the runtime's role resolution, or one that
 * gives a helper the wrong kind of value.
 */
export function evaluateGuard(
	expr: string,
	facts: GuardFacts,
	options: GuardOptions = {}
): GuardValue {
	const scope = { facts, now: options.now ?? new Date() };
	const result = truth(evaluate(parseGuard(expr), scope));
	return result === UNKNOWN ? undefined : result;
}

/** How one part of a guard reads over a set of facts, for showing which part decided it. */
export interface GuardTrace {
	ast: GuardAst;
	/** The part's text, as written in the expression. */
	text: string;
	/** `unknown` while a fact it reads is not recorded; `error` when it cannot be evaluated. */
	result: 'true' | 'false' | 'unknown' | 'error';
	/** Why it could not be evaluated. */
	error?: string;
	/** Facts it reads that are not recorded. */
	missing: string[];
	/** For `and`, `or` and `not`: the parts it combines, flattened across a chain of one operator. */
	parts: GuardTrace[];
}

/**
 * Evaluates every part of a guard over the facts, so a test can show which part made it true or
 * false. Throws a GuardSyntaxError only when the expression does not parse; a part that cannot be
 * evaluated reads as an `error` part.
 */
export function explainGuard(
	expr: string,
	facts: GuardFacts,
	options: GuardOptions = {}
): GuardTrace {
	const scope = { facts, now: options.now ?? new Date() };
	const trace = (ast: GuardAst): GuardTrace => {
		const parts =
			ast.kind === 'logic'
				? flatten(ast).map(trace)
				: ast.kind === 'not'
					? [trace(ast.operand)]
					: [];
		const missing = [...new Set(refsOf(ast).filter((f) => !Object.hasOwn(facts, f)))];
		const base = { ast, text: expr.slice(ast.span[0], ast.span[1]), missing, parts };
		try {
			const value = truth(evaluate(ast, scope));
			return { ...base, result: value === UNKNOWN ? 'unknown' : value ? 'true' : 'false' };
		} catch (error) {
			if (!(error instanceof GuardSyntaxError)) throw error;
			return { ...base, result: 'error', error: error.message };
		}
	};
	return trace(parseGuard(expr));
}

/** The operands of a chain of one logic operator, such as the three parts of `a && b && c`. */
export function flatten(ast: GuardAst & { kind: 'logic' }): GuardAst[] {
	const side = (a: GuardAst): GuardAst[] =>
		a.kind === 'logic' && a.op === ast.op ? flatten(a) : [a];
	return [...side(ast.left), ...side(ast.right)];
}

function refsOf(ast: GuardAst): string[] {
	switch (ast.kind) {
		case 'ref':
			return [ast.fact];
		case 'list':
			return ast.items.flatMap(refsOf);
		case 'call':
			return ast.args.flatMap(refsOf);
		case 'not':
			return refsOf(ast.operand);
		case 'logic':
		case 'compare':
			return [...refsOf(ast.left), ...refsOf(ast.right)];
		default:
			return [];
	}
}

function evaluate(ast: GuardAst, scope: Scope): Value {
	switch (ast.kind) {
		case 'literal':
			return ast.value;
		case 'ref': {
			if (!Object.hasOwn(scope.facts, ast.fact)) return UNKNOWN;
			let value: unknown = scope.facts[ast.fact];
			for (const key of ast.path) {
				if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) {
					return UNKNOWN;
				}
				value = (value as Record<string, unknown>)[key];
			}
			return value;
		}
		case 'role':
			throw new GuardSyntaxError(`${ast.role}: role references are not evaluated yet`, ast.span[0]);
		case 'list':
			return ast.items.map((item) => evaluate(item, scope));
		case 'call':
			return call(ast, scope);
		case 'not': {
			const operand = truth(evaluate(ast.operand, scope));
			return operand === UNKNOWN ? UNKNOWN : !operand;
		}
		case 'logic': {
			const left = truth(evaluate(ast.left, scope));
			if (ast.op === '&&' && left === false) return false;
			if (ast.op === '||' && left === true) return true;
			const right = truth(evaluate(ast.right, scope));
			if (left === UNKNOWN || right === UNKNOWN) {
				if (ast.op === '&&' && right === false) return false;
				if (ast.op === '||' && right === true) return true;
				return UNKNOWN;
			}
			return right;
		}
		case 'compare':
			return compare(ast, scope);
	}
}

function compare(ast: GuardAst & { kind: 'compare' }, scope: Scope): Value {
	const isNull = (a: GuardAst) => a.kind === 'literal' && a.value === null;
	let left = evaluate(ast.left, scope);
	let right = evaluate(ast.right, scope);
	if ((ast.op === '==' || ast.op === '!=') && (isNull(ast.left) || isNull(ast.right))) {
		// A missing fact counts as null when compared with null.
		if (left === UNKNOWN) left = null;
		if (right === UNKNOWN) right = null;
	}
	if (left === UNKNOWN || right === UNKNOWN) return UNKNOWN;
	if (Array.isArray(right) && right.includes(UNKNOWN)) return UNKNOWN;
	switch (ast.op) {
		case '==':
			return equal(left, right);
		case '!=':
			return !equal(left, right);
		case 'in':
			if (Array.isArray(right)) return right.some((r) => equal(left, r));
			if (typeof right === 'string' && typeof left === 'string') return right.includes(left);
			throw new GuardSyntaxError('"in" needs a list or a text on its right', ast.right.span[0]);
		default: {
			const ordered =
				(typeof left === 'number' && typeof right === 'number') ||
				(typeof left === 'string' && typeof right === 'string');
			if (!ordered) return false;
			const [a, b] = [left as number | string, right as number | string];
			return ast.op === '<' ? a < b : ast.op === '<=' ? a <= b : ast.op === '>' ? a > b : a >= b;
		}
	}
}

const DAY = 86_400_000;

function call(ast: GuardAst & { kind: 'call' }, scope: Scope): Value {
	const fail = (message: string): never => {
		throw new GuardSyntaxError(message, ast.span[0]);
	};
	// is_set and is_empty are always known: a fact nobody recorded is empty.
	if (ast.name === 'is_set' || ast.name === 'is_empty') {
		const value = evaluate(ast.args[0]!, scope);
		const empty =
			value === UNKNOWN ||
			value === null ||
			value === undefined ||
			value === '' ||
			(Array.isArray(value) && value.length === 0);
		return ast.name === 'is_empty' ? empty : !empty;
	}
	const args = ast.args.map((a) => evaluate(a, scope));
	if (args.includes(UNKNOWN)) return UNKNOWN;
	const day = (value: unknown): number => {
		const ms = typeof value === 'string' ? dayOf(value) : undefined;
		return ms ?? fail(`${ast.name} needs a date, not ${describeValue(value)}`);
	};
	const today = () => Date.UTC(...ymd(scope.now));
	switch (ast.name) {
		case 'today':
			return isoDay(today());
		case 'days_since':
			return Math.round((today() - day(args[0])) / DAY);
		case 'days_between':
			return Math.round((day(args[1]) - day(args[0])) / DAY);
		case 'add_days': {
			const n = args[1];
			if (typeof n !== 'number') fail(`add_days needs a number of days, not ${describeValue(n)}`);
			return isoDay(day(args[0]) + Math.round(n as number) * DAY);
		}
		case 'contains': {
			const [within, value] = args;
			if (Array.isArray(within)) return within.some((x) => equal(x, value));
			if (typeof within === 'string' && typeof value === 'string') {
				return within.toLowerCase().includes(value.toLowerCase());
			}
			if (within === null) return false;
			return fail(`contains needs a list or a text, not ${describeValue(within)}`);
		}
		case 'count': {
			const [list] = args;
			if (list === null) return 0;
			if (Array.isArray(list)) return list.length;
			return fail(`count needs a list, not ${describeValue(list)}`);
		}
		default:
			return fail(`"${ast.name}" is not a fact, helper or word a condition can use`);
	}
}

const ymd = (d: Date) => [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()] as const;

/** Midnight UTC of the day an ISO date or date-time falls on, or undefined when it is not one. */
function dayOf(text: string): number | undefined {
	if (!/^\d{4}-\d{2}-\d{2}/.test(text)) return undefined;
	const at = new Date(text.length === 10 ? `${text}T00:00:00Z` : text);
	return Number.isNaN(at.getTime()) ? undefined : Date.UTC(...ymd(at));
}

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function describeValue(value: unknown): string {
	if (value === null || value === undefined) return 'nothing';
	if (Array.isArray(value)) return 'a list';
	if (typeof value === 'string') return `the text "${value}"`;
	if (typeof value === 'object') return 'a record';
	return String(value);
}

function equal(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (Array.isArray(a) && Array.isArray(b)) {
		return a.length === b.length && a.every((x, i) => equal(x, b[i]));
	}
	return false;
}

function truth(value: Value): boolean | typeof UNKNOWN {
	if (value === UNKNOWN) return UNKNOWN;
	if (typeof value === 'boolean') return value;
	return value !== null && value !== undefined && value !== '' && value !== 0;
}
