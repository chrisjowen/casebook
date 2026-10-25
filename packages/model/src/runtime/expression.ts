/**
 * Evaluates guard expressions over a case's facts (ADR 0004).
 *
 * The language is deliberately small and sandboxed: literals (`true`, `false`, `null`, numbers,
 * quoted strings and `[...]` lists), fact references such as `fact.severity` or
 * `fact.address.city`, comparisons (`==`, `!=`, `<`, `<=`, `>`, `>=`, `in`), `!`/`not`,
 * `&&`/`and`, `||`/`or` and parentheses. Nothing else is evaluated, so an expression can never
 * call code or reach outside the facts it is given.
 *
 * A fact that has not been recorded yet is unknown, and the answer may be unknown too. Logic is
 * three-valued: `false && unknown` is false, `true || unknown` is true. Comparing with `null` is
 * always known, because a missing fact counts as null there, which is how `until` conditions
 * such as `fact.resolved-at != null` are written.
 */

/** True, false, or undefined when it depends on facts nobody has recorded yet. */
export type GuardValue = boolean | undefined;

/** An expression that does not parse; the engine treats its guard as prose only. */
export class GuardSyntaxError extends Error {
	override readonly name = 'GuardSyntaxError';
}

type Token =
	| { kind: 'literal'; value: unknown }
	| { kind: 'ref'; path: string[] }
	| { kind: 'op'; value: string };

type Ast =
	| { kind: 'literal'; value: unknown }
	| { kind: 'ref'; fact: string; path: string[] }
	| { kind: 'role'; role: string }
	| { kind: 'list'; items: Ast[] }
	| { kind: 'not'; operand: Ast }
	| { kind: 'logic'; op: '&&' | '||'; left: Ast; right: Ast }
	| { kind: 'compare'; op: string; left: Ast; right: Ast };

const COMPARISONS = new Set(['==', '!=', '<', '<=', '>', '>=', 'in']);
const WORDS: Record<string, Token> = {
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
		const quoted = /^'((?:[^'\\]|\\.)*)'|^"((?:[^"\\]|\\.)*)"/.exec(rest);
		if (quoted) {
			const body = quoted[1] ?? quoted[2] ?? '';
			tokens.push({ kind: 'literal', value: body.replace(/\\(.)/g, '$1') });
			i += quoted[0].length;
			continue;
		}
		const number = /^-?\d+(?:\.\d+)?/.exec(rest);
		if (number) {
			tokens.push({ kind: 'literal', value: Number(number[0]) });
			i += number[0].length;
			continue;
		}
		const ref = /^(?:fact|role)\.\w+(?:-\w+)*(?:\.\w+(?:-\w+)*)*/.exec(rest);
		if (ref) {
			tokens.push({ kind: 'ref', path: ref[0].split('.') });
			i += ref[0].length;
			continue;
		}
		const word = /^[A-Za-z_]\w*/.exec(rest);
		if (word) {
			const known = WORDS[word[0]];
			if (!known) throw new GuardSyntaxError(`"${word[0]}" is not something a guard can use`);
			tokens.push(known);
			i += word[0].length;
			continue;
		}
		const op = /^(?:==|!=|<=|>=|&&|\|\||[<>!()[\],])/.exec(rest);
		if (op) {
			tokens.push({ kind: 'op', value: op[0] });
			i += op[0].length;
			continue;
		}
		throw new GuardSyntaxError(`unexpected "${rest[0]}" at position ${i}`);
	}
	return tokens;
}

/** Parses a guard expression, or throws a GuardSyntaxError explaining what is wrong. */
export function parseGuard(expr: string): Ast {
	const tokens = tokenize(expr);
	let at = 0;
	const peek = () => tokens[at];
	const isOp = (value: string) => {
		const t = peek();
		return t?.kind === 'op' && t.value === value;
	};
	const expect = (value: string) => {
		if (!isOp(value)) throw new GuardSyntaxError(`expected "${value}"`);
		at++;
	};

	const primary = (): Ast => {
		const t = tokens[at++];
		if (!t) throw new GuardSyntaxError('the expression ends too early');
		if (t.kind === 'literal') return { kind: 'literal', value: t.value };
		if (t.kind === 'ref') {
			const [head, name, ...path] = t.path;
			const id = `${head}.${name}`;
			return head === 'role' ? { kind: 'role', role: id } : { kind: 'ref', fact: id, path };
		}
		if (t.value === '(') {
			const inner = or();
			expect(')');
			return inner;
		}
		if (t.value === '[') {
			const items: Ast[] = [];
			if (!isOp(']')) {
				items.push(or());
				while (isOp(',')) {
					at++;
					items.push(or());
				}
			}
			expect(']');
			return { kind: 'list', items };
		}
		throw new GuardSyntaxError(`unexpected "${t.value}"`);
	};
	const comparison = (): Ast => {
		const left = primary();
		const t = peek();
		if (t?.kind === 'op' && COMPARISONS.has(t.value)) {
			at++;
			return { kind: 'compare', op: t.value, left, right: primary() };
		}
		return left;
	};
	const not = (): Ast => {
		if (isOp('!')) {
			at++;
			return { kind: 'not', operand: not() };
		}
		return comparison();
	};
	const and = (): Ast => {
		let left = not();
		while (isOp('&&')) {
			at++;
			left = { kind: 'logic', op: '&&', left, right: not() };
		}
		return left;
	};
	const or = (): Ast => {
		let left = and();
		while (isOp('||')) {
			at++;
			left = { kind: 'logic', op: '||', left, right: and() };
		}
		return left;
	};

	const ast = or();
	if (at < tokens.length)
		throw new GuardSyntaxError('there is more after the end of the expression');
	return ast;
}

/** Facts as a guard reads them: the current value of each recorded fact, by fact id. */
export type GuardFacts = Readonly<Record<string, unknown>>;

const UNKNOWN = Symbol('unknown');
type Value = unknown;

/**
 * Evaluates a guard expression over the recorded facts. Returns undefined when the answer depends
 * on a fact that is not recorded yet. Throws a GuardSyntaxError for an expression that does not
 * parse, or one that uses role references, which need the runtime's role resolution.
 */
export function evaluateGuard(expr: string, facts: GuardFacts): GuardValue {
	const result = truth(evaluate(parseGuard(expr), facts));
	return result === UNKNOWN ? undefined : result;
}

function evaluate(ast: Ast, facts: GuardFacts): Value {
	switch (ast.kind) {
		case 'literal':
			return ast.value;
		case 'ref': {
			if (!Object.hasOwn(facts, ast.fact)) return UNKNOWN;
			let value: unknown = facts[ast.fact];
			for (const key of ast.path) {
				if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) {
					return UNKNOWN;
				}
				value = (value as Record<string, unknown>)[key];
			}
			return value;
		}
		case 'role':
			throw new GuardSyntaxError(`${ast.role}: role references are not evaluated yet`);
		case 'list':
			return ast.items.map((item) => evaluate(item, facts));
		case 'not': {
			const operand = truth(evaluate(ast.operand, facts));
			return operand === UNKNOWN ? UNKNOWN : !operand;
		}
		case 'logic': {
			const left = truth(evaluate(ast.left, facts));
			if (ast.op === '&&' && left === false) return false;
			if (ast.op === '||' && left === true) return true;
			const right = truth(evaluate(ast.right, facts));
			if (left === UNKNOWN || right === UNKNOWN) {
				if (ast.op === '&&' && right === false) return false;
				if (ast.op === '||' && right === true) return true;
				return UNKNOWN;
			}
			return right;
		}
		case 'compare':
			return compare(ast, facts);
	}
}

function compare(ast: Extract<Ast, { kind: 'compare' }>, facts: GuardFacts): Value {
	const isNull = (a: Ast) => a.kind === 'literal' && a.value === null;
	let left = evaluate(ast.left, facts);
	let right = evaluate(ast.right, facts);
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
			throw new GuardSyntaxError('"in" needs a list or a string on its right');
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
