/**
 * Reads the fact and role references out of a guard expression (ADR 0004).
 *
 * The expression language is not chosen yet, so this parses conservatively: it ignores string
 * literals and picks out tokens shaped like node ids, `fact.<name>` or `role.<name>`, that are not
 * part of a longer dotted name. A property access such as `fact.address.city` yields
 * `fact.address`. Anything else in the expression is left alone.
 */
export interface GuardReferences {
	facts: string[];
	roles: string[];
}

const STRING_LITERAL = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g;
const REFERENCE = /(?<![\w$.])(fact|role)\.\w+(?:-\w+)*/g;

export function guardReferences(expr: string): GuardReferences {
	const code = expr.replace(STRING_LITERAL, '""');
	const facts = new Set<string>();
	const roles = new Set<string>();
	for (const match of code.matchAll(REFERENCE)) {
		(match[1] === 'fact' ? facts : roles).add(match[0]);
	}
	return { facts: [...facts], roles: [...roles] };
}
