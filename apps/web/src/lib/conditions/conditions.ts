/**
 * Conditions in the editor: how facts read in the builder and in plain English, what the code
 * view suggests as someone types, and whether the code works. Pure, so it is tested without a
 * browser; the components in this folder draw it.
 */
import {
	conditionKind,
	describeGuard,
	GUARD_HELPERS,
	GuardSyntaxError,
	parseGuard,
	type ConditionKind,
	type FactInfo,
	type FactNode,
	type GuardAst
} from '@casebook/model';
import { factType, labelOf, type FactGlyph, type ProcessIndex } from '$lib/graph/derive';

export interface FactOption {
	id: string;
	name: string;
	kind: ConditionKind;
	/** The fact's kind in words, such as "Choice" or "Date". */
	type: string;
	glyph: FactGlyph;
}

/** The process's facts as the builder and autocomplete offer them, by name. */
export function factOptions(ix: ProcessIndex): FactOption[] {
	return ix.facts
		.map((f) => ({
			id: f.core.id,
			name: labelOf(ix, f.core.id),
			kind: conditionKind(f.core.schema),
			...(({ label, glyph }) => ({ type: label, glyph }))(factType(f.core.schema))
		}))
		.sort((a, b) => a.name.localeCompare(b.name));
}

/** The fact a reference such as `fact.address.city` reads, and the property path inside it. */
export function splitRef(ref: string): { fact: string; path: string[] } {
	const [head, name, ...path] = ref.split('.');
	return { fact: `${head}.${name}`, path };
}

/** How facts read in plain English in this process: "Address › city" for a property. */
export function factInfo(ix: ProcessIndex): FactInfo {
	return (ref) => {
		const { fact, path } = splitRef(ref);
		const node = ix.byId.get(fact) as FactNode | undefined;
		const name = [labelOf(ix, fact), ...path].join(' › ');
		return { name, kind: path.length ? 'text' : conditionKind(node?.core.schema) };
	};
}

/** The values a fact can be chosen from, when its schema lists them. */
export function choicesOf(ix: ProcessIndex, ref: string): string[] | undefined {
	const node = ix.byId.get(splitRef(ref).fact) as FactNode | undefined;
	const values = node?.core.schema.enum;
	return Array.isArray(values) ? values.map(String) : undefined;
}

/** A condition in plain English, or undefined when its code does not parse. */
export function describe(ix: ProcessIndex, expr: string | undefined): string | undefined {
	return expr ? describeGuard(expr, factInfo(ix)) : undefined;
}

/** What is wrong with condition code, and where; undefined when it works. */
export interface CodeProblem {
	message: string;
	at: number;
	length: number;
}

/**
 * Checks condition code: that it parses, and that every fact it reads is one of this process's.
 * Role references parse but are not evaluated yet, so they are reported too.
 */
export function checkCode(ix: ProcessIndex, expr: string): CodeProblem | undefined {
	let ast: GuardAst;
	try {
		ast = parseGuard(expr);
	} catch (error) {
		if (!(error instanceof GuardSyntaxError)) throw error;
		const at = Math.min(error.at ?? 0, expr.length);
		const length = /^[\w.-]+/.exec(expr.slice(at))?.[0].length ?? 1;
		return { message: sentence(error.message), at, length };
	}
	for (const node of walk(ast)) {
		if (node.kind === 'ref' && ix.byId.get(node.fact)?.core.kind !== 'fact') {
			return {
				message: `This process has no fact called ${node.fact}.`,
				at: node.span[0],
				length: node.span[1] - node.span[0]
			};
		}
		if (node.kind === 'role') {
			return {
				message: 'Roles cannot be used in conditions yet; use a fact instead.',
				at: node.span[0],
				length: node.span[1] - node.span[0]
			};
		}
	}
	return undefined;
}

function* walk(ast: GuardAst): Generator<GuardAst> {
	yield ast;
	switch (ast.kind) {
		case 'list':
			for (const item of ast.items) yield* walk(item);
			break;
		case 'call':
			for (const arg of ast.args) yield* walk(arg);
			break;
		case 'not':
			yield* walk(ast.operand);
			break;
		case 'logic':
		case 'compare':
			yield* walk(ast.left);
			yield* walk(ast.right);
			break;
	}
}

/** Today's date as YYYY-MM-DD, in UTC like the evaluator. */
export const todayIso = () => new Date().toISOString().slice(0, 10);

const sentence = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;

// ---------------------------------------------------------------------------
// Autocomplete
// ---------------------------------------------------------------------------

export interface Suggestion {
	kind: 'fact' | 'helper' | 'operator' | 'value' | 'word';
	/** What the list shows. */
	label: string;
	/** A second, quieter line: the fact's kind, a helper's description, an operator's meaning. */
	detail: string;
	/** What replaces the word being typed. */
	insert: string;
	/** Where the cursor goes, counted from the start of `insert`; its end when absent. */
	cursor?: number;
}

export interface Completion {
	/** The text the suggestion replaces: from `from` to the cursor. */
	from: number;
	items: Suggestion[];
}

const OPERATORS: Suggestion[] = [
	['==', 'is'],
	['!=', 'is not'],
	['in', 'is one of a list'],
	['>', 'is more than, or after'],
	['>=', 'is at least, or on or after'],
	['<', 'is less than, or before'],
	['<=', 'is at most, or on or before'],
	['and', 'both must hold'],
	['or', 'either may hold']
].map(([label, detail]) => ({
	kind: 'operator',
	label: label!,
	detail: detail!,
	insert: `${label} `
}));

const WORDS: Suggestion[] = [
	['not', 'the opposite of what follows'],
	['true', 'Yes'],
	['false', 'No'],
	['null', 'nothing recorded']
].map(([label, detail]) => ({ kind: 'word', label: label!, detail: detail!, insert: label! }));

const HELPERS: Suggestion[] = GUARD_HELPERS.map((h) => ({
	kind: 'helper',
	label: h.signature,
	detail: h.description,
	insert: `${h.name}()`,
	cursor: h.arity === 0 ? undefined : h.name.length + 1
}));

/**
 * What to suggest at the cursor. After a value it offers operators; where a value is expected it
 * offers facts, helpers and, after comparing a choice fact, that fact's choices. A word being
 * typed narrows the list by name.
 */
export function complete(ix: ProcessIndex, text: string, cursor: number): Completion {
	const before = text.slice(0, cursor);
	const word = /[\w.-]*$/.exec(before)![0];
	const from = cursor - word.length;
	const head = before.slice(0, from).trimEnd();
	const afterValue =
		/(?:[\w'")\]]|fact\.[\w.-]+)$/.test(head) && !/\b(?:and|or|not|in)$/.test(head);
	const facts: Suggestion[] = factOptions(ix).map((f) => ({
		kind: 'fact',
		label: f.name,
		detail: f.type,
		insert: f.id
	}));

	if (!word) {
		if (afterValue) return { from, items: OPERATORS };
		const choices = choicesBefore(ix, head);
		return { from, items: [...choices, ...facts, ...HELPERS, ...WORDS] };
	}
	if (/^['"]/.test(word)) return { from, items: [] };
	const q = word.toLowerCase();
	const matches = (s: Suggestion) =>
		s.label.toLowerCase().includes(q) || s.insert.toLowerCase().startsWith(q);
	const pool =
		afterValue && !word.startsWith('fact.') ? OPERATORS : [...facts, ...HELPERS, ...WORDS];
	const items = pool.filter(matches);
	// The best match first: names starting with what was typed.
	items.sort(
		(a, b) =>
			Number(!a.label.toLowerCase().startsWith(q)) - Number(!b.label.toLowerCase().startsWith(q))
	);
	if (items.length === 1 && items[0]!.insert.trim() === word) return { from, items: [] };
	return { from, items };
}

/** A choice fact's values, when the code just compared it: `fact.severity == ` or `in [`. */
function choicesBefore(ix: ProcessIndex, head: string): Suggestion[] {
	const m = /(fact\.[\w-]+(?:\.[\w-]+)*)\s*(?:==|!=|in\s*\[(?:[^\]]*,)?)\s*$/.exec(head);
	if (!m) return [];
	return (choicesOf(ix, m[1]!) ?? []).map((c) => ({
		kind: 'value',
		label: c,
		detail: 'Choice',
		insert: `'${c.replaceAll("'", "\\'")}'`
	}));
}
