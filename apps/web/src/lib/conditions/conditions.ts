/**
 * Conditions in the editor: how facts read in the builder and in plain English, what the code
 * view suggests as someone types, and whether the code works. Pure, so it is tested without a
 * browser; the components in this folder draw it.
 */
import {
	calendarDay,
	conditionKind,
	describeGuard,
	evaluateGuard,
	guardReferences,
	GUARD_HELPERS,
	GuardSyntaxError,
	parseGuard,
	type ConditionKind,
	type FactInfo,
	type FactNode,
	type GuardAst
} from '@casebook/model';
import {
	collectsOf,
	factType,
	labelOf,
	type FactGlyph,
	type ProcessIndex,
	type WorkItem
} from '$lib/graph/derive';

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

/** Someone a people fact can hold. */
export interface Person {
	id: string;
	name: string;
}

/**
 * How facts read in plain English in this process: "Address › city" for a property, and people
 * by name when the instance's people are known.
 */
export function factInfo(ix: ProcessIndex, people?: Person[]): FactInfo {
	return (ref) => {
		const { fact, path } = splitRef(ref);
		const node = ix.byId.get(fact) as FactNode | undefined;
		const name = [labelOf(ix, fact), ...path].join(' › ');
		const kind = path.length ? 'text' : conditionKind(node?.core.schema);
		const valueName =
			kind === 'people' && people
				? (id: string) => people.find((p) => p.id === id)?.name ?? id
				: undefined;
		return { name, kind, ...(valueName ? { valueName } : {}) };
	};
}

/** The values a fact can be chosen from, when its schema lists them. */
export function choicesOf(ix: ProcessIndex, ref: string): string[] | undefined {
	const node = ix.byId.get(splitRef(ref).fact) as FactNode | undefined;
	const values = node?.core.schema.enum;
	return Array.isArray(values) ? values.map(String) : undefined;
}

/** A condition in plain English, or undefined when its code does not parse. */
export function describe(
	ix: ProcessIndex,
	expr: string | undefined,
	people?: Person[]
): string | undefined {
	return expr ? describeGuard(expr, factInfo(ix, people)) : undefined;
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
		const word = /^[\w.-]+/.exec(expr.slice(at))?.[0];
		const near = word && /^[a-z_]/i.test(word) ? closestFact(ix, word) : undefined;
		return {
			message: `${sentence(error.message)}${near ? ` Did you mean ${near.name} (${near.id})?` : ''}`,
			at,
			length: word?.length ?? 1
		};
	}
	for (const node of walk(ast)) {
		if (node.kind === 'ref' && ix.byId.get(node.fact)?.core.kind !== 'fact') {
			const near = closestFact(ix, node.fact);
			return {
				message: `This process has no fact called ${node.fact}.${near ? ` Did you mean ${near.name} (${near.id})?` : ''}`,
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

/** Today's date in a time zone as YYYY-MM-DD. */
export function todayIso(timeZone: string): string {
	return calendarDay(new Date(), timeZone);
}

/** A moment on a day in a time zone, for evaluating a condition as if today were that day. */
export function momentOn(day: string, timeZone: string): Date {
	const noon = new Date(`${day}T12:00:00Z`);
	return new Date(noon.getTime() - (Date.parse(calendarDay(noon, timeZone)) - Date.parse(day)));
}

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

/** The fact whose id or name is nearest to what was typed, when one is near enough. */
export function closestFact(ix: ProcessIndex, typed: string): FactOption | undefined {
	const t = typed.toLowerCase().replace(/^fact\./, '');
	let best: { f: FactOption; d: number } | undefined;
	for (const f of factOptions(ix)) {
		const slug = f.id.slice('fact.'.length);
		const name = f.name.toLowerCase();
		if (t.length >= 2 && (slug.startsWith(t) || name.startsWith(t))) return f;
		const d = Math.min(distance(t, slug), distance(t, name));
		if (!best || d < best.d) best = { f, d };
	}
	return best && best.d <= Math.max(2, Math.floor(t.length / 3)) ? best.f : undefined;
}

function distance(a: string, b: string): number {
	const row = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		let prev = row[0]!;
		row[0] = i;
		for (let j = 1; j <= b.length; j++) {
			const next = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
			prev = row[j]!;
			row[j] = next;
		}
	}
	return row[b.length]!;
}

/**
 * When each fact is recorded, seen from one step or decision: `before` when something in an
 * earlier or the same stage records it, `self` when only this item does, `later` when only later
 * stages do, and `never` when nothing in the process records it.
 */
export type FactTiming = 'before' | 'self' | 'later' | 'never';

export function factTiming(ix: ProcessIndex, itemId: string): Map<string, FactTiming> {
	const stageOf = (w: WorkItem) => ix.stages.findIndex((s) => s.core.id === w.core.stage);
	const item = ix.work.find((w) => w.core.id === itemId);
	const here = item ? stageOf(item) : Infinity;
	const timing = new Map<string, FactTiming>();
	for (const f of ix.facts) {
		const collectors = ix.work.filter((w) => collectsOf(w).some((c) => c.fact === f.core.id));
		const others = collectors.filter((w) => w.core.id !== itemId);
		timing.set(
			f.core.id,
			others.some((w) => stageOf(w) <= here)
				? 'before'
				: collectors.some((w) => w.core.id === itemId)
					? 'self'
					: others.length
						? 'later'
						: 'never'
		);
	}
	return timing;
}

/**
 * The choices of a decision's outcome a step is a branch for: those its condition does not rule
 * out when the outcome is that choice, counting an answer that waits on other facts as one it may
 * run for. Empty when its condition does not read the outcome, or reads the same whatever the
 * choice, as `fact.severity != null` does.
 */
export function choicesRunning(item: WorkItem, outcome: string, choices: string[]): string[] {
	const expr = item.core.when?.expr;
	if (!expr) return [];
	try {
		if (!guardReferences(expr).facts.includes(outcome)) return [];
		const answers = choices.map((c) => evaluateGuard(expr, { [outcome]: c }));
		if (answers.every((a) => a === answers[0])) return [];
		return choices.filter((_, i) => answers[i] !== false);
	} catch {
		return [];
	}
}

/** The choices of a decision a step is a branch for, as `choicesRunning` finds them. */
export function branchChoices(ix: ProcessIndex, decision: WorkItem, item: WorkItem): string[] {
	if (decision.core.kind !== 'decision') return [];
	const outcome = decision.core.outcome;
	return choicesRunning(item, outcome, choicesOf(ix, outcome) ?? []);
}

/** A helper's example, with facts of this process where it has one of the right kind. */
export function helperExample(ix: ProcessIndex, name: string, example: string): string {
	const options = factOptions(ix);
	const of = (...kinds: string[]) => options.find((f) => kinds.includes(f.kind))?.id;
	const date = of('date');
	const list = of('people', 'list');
	const text = of('text', 'choice', 'lookup');
	const any = options[0]?.id;
	switch (name) {
		case 'today':
			return date ? `${date} < today()` : example;
		case 'days_since':
			return date ? `days_since(${date}) > 3` : example;
		case 'add_days':
			return date ? `${date} < add_days(today(), 7)` : example;
		case 'contains':
			return list ? `contains(${list}, '…')` : text ? `contains(${text}, '…')` : example;
		case 'count':
			return list ? `count(${list}) >= 2` : example;
		case 'is_set':
		case 'is_empty':
			return any ? `${name}(${any})` : example;
		default:
			return example;
	}
}
