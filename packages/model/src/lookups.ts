import type {
	DefinitionDocument,
	FactId,
	FactSchema,
	LookupCore,
	LookupId,
	LookupNode,
	LookupValue,
	Node
} from './node.js';

/**
 * Lookups (ADR 0025): named lists of values that choice facts are chosen from. A process lookup is
 * a `lookup` node in the definition; a shared lookup is a namespace-level list of the same shape
 * that a fact names with `x-lookup: { kind: 'dataset' }`. The functions here are pure: reading a
 * fact's choices, describing what a change to a list did, and the value-list edits the editor and
 * the store make.
 */

/** A shared lookup's content, as a namespace stores it: the same values as a lookup node. */
export interface LookupList {
	title: string;
	values: LookupValue[];
	/** Guidance for people, in Markdown. */
	content?: string;
}

/** Shared lookups a definition can see, by the name facts use for them. */
export type SharedLookups = ReadonlyMap<string, LookupList>;

/** One choice a form offers or a record shows: the stored value and how it reads. */
export interface Choice {
	value: string;
	label: string;
	code?: string;
	/** What it means, for whoever chooses it. */
	description?: string;
	/** Turned off: not offered for new entries, but still read on cases that hold it. */
	disabled?: boolean;
}

/** Where a fact's choices come from, for showing and editing that link. */
export type ChoiceSource =
	| { kind: 'own' }
	| { kind: 'lookup'; lookup: LookupId; title: string }
	| { kind: 'shared'; name: string; title: string; found: boolean };

/** How a value reads: its label, or the value itself. */
export const labelOfValue = (v: LookupValue): string => v.label ?? v.value;

const toChoice = (v: LookupValue): Choice => ({
	value: v.value,
	label: labelOfValue(v),
	...(v.code === undefined ? {} : { code: v.code }),
	...(v.description === undefined ? {} : { description: v.description }),
	...(v.disabled ? { disabled: true } : {})
});

/** The lookup node with this id, if the definition has one. */
export function lookupNode(document: DefinitionDocument, id: string): LookupNode | undefined {
	const node = document.nodes.find((n) => n.core.id === id);
	return node?.core.kind === 'lookup' ? (node as LookupNode) : undefined;
}

/** The lookup nodes of a definition, in document order. */
export function lookupNodes(document: DefinitionDocument): LookupNode[] {
	return document.nodes.filter((n): n is LookupNode => n.core.kind === 'lookup');
}

/** Where a fact's choices come from, or undefined when it is not a choice. */
export function choiceSource(
	document: DefinitionDocument,
	schema: FactSchema,
	shared: SharedLookups = new Map()
): ChoiceSource | undefined {
	const lookup = schema['x-lookup'];
	if (lookup?.kind === 'lookup') {
		const node = lookupNode(document, lookup.lookup);
		return { kind: 'lookup', lookup: lookup.lookup, title: node?.core.title ?? lookup.lookup };
	}
	if (lookup?.kind === 'dataset') {
		const list = shared.get(lookup.dataset);
		return {
			kind: 'shared',
			name: lookup.dataset,
			title: list?.title ?? lookup.dataset.replaceAll('-', ' '),
			found: list !== undefined
		};
	}
	return ownOptions(schema) === undefined ? undefined : { kind: 'own' };
}

/** A fact's own options, from `enum` on its schema or on its items for a list. */
function ownOptions(schema: FactSchema): unknown[] | undefined {
	if (Array.isArray(schema.enum)) return schema.enum as unknown[];
	const items = schema.items as FactSchema | undefined;
	return items && Array.isArray(items.enum) ? (items.enum as unknown[]) : undefined;
}

/**
 * Every choice a fact has, turned-off ones included, in order: from the lookup it names, the
 * shared lookup it names when `shared` has it, or its own options. Undefined when the fact is not
 * a choice, or names a shared lookup `shared` does not have.
 */
export function factChoices(
	document: DefinitionDocument,
	schema: FactSchema,
	shared: SharedLookups = new Map()
): Choice[] | undefined {
	const lookup = schema['x-lookup'];
	if (lookup?.kind === 'lookup')
		return lookupNode(document, lookup.lookup)?.core.values.map(toChoice);
	if (lookup?.kind === 'dataset') return shared.get(lookup.dataset)?.values.map(toChoice);
	return ownOptions(schema)?.map((o) => ({ value: String(o), label: String(o) }));
}

/** The facts that choose from a lookup node, in document order. */
export function factsUsingLookup(document: DefinitionDocument, id: string): FactId[] {
	return document.nodes.flatMap((n) => {
		if (n.core.kind !== 'fact') return [];
		const lookup = n.core.schema['x-lookup'];
		return lookup?.kind === 'lookup' && lookup.lookup === id ? [n.core.id] : [];
	});
}

/** The facts that choose from the shared lookup `name`, in document order. */
export function factsUsingShared(document: DefinitionDocument, name: string): FactId[] {
	return document.nodes.flatMap((n) => {
		if (n.core.kind !== 'fact') return [];
		const lookup = n.core.schema['x-lookup'];
		return lookup?.kind === 'dataset' && lookup.dataset === name ? [n.core.id] : [];
	});
}

/**
 * Why `value` cannot be recorded for a fact chosen from `choices`, or undefined when it can. A
 * turned-off value is refused unless it is what the case already holds, so a form that keeps an
 * old value still saves. For a list, each item is checked.
 */
export function choiceProblem(
	name: string,
	choices: readonly Choice[],
	value: unknown,
	current?: unknown
): string | undefined {
	const kept = new Set(
		(Array.isArray(current) ? current : current === undefined ? [] : [current]).map(String)
	);
	for (const v of Array.isArray(value) ? value : [value]) {
		const choice = choices.find((c) => c.value === v);
		if (!choice) {
			// a short list is worth naming; a long one, such as countries, is not
			const offered = choices.filter((c) => !c.disabled).map((c) => c.label);
			return offered.length <= 8
				? `${name}: must be one of ${offered.join(', ')}`
				: `${name}: "${String(v)}" is not one of the choices`;
		}
		if (choice.disabled && !kept.has(choice.value)) {
			return `${name}: ${choice.label} is no longer offered; choose another`;
		}
	}
	return undefined;
}

// Editing a list of values. Each returns the new list, leaving the input untouched, or the reason
// it cannot be done, in plain language.

export type ValuesEdit = LookupValue[] | string;

/**
 * Reads values typed or pasted in: one per line, or one per comma when there is a single line.
 * A line copied from a spreadsheet, `Label<TAB>Code`, gives the value a code too.
 */
export function readValueLines(text: string): { label: string; code?: string }[] {
	const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
	const parts = lines.length === 1 && !lines[0]!.includes('\t') ? lines[0]!.split(',') : lines;
	return parts.flatMap((line) => {
		const [label = '', code = ''] = line.split('\t').map((c) => c.trim());
		if (!label) return [];
		return [code ? { label, code } : { label }];
	});
}

/**
 * Adds values by label, each stored as its label. A label already in the list is skipped, so
 * pasting a list twice adds nothing; when every one was there already, says so.
 */
export function addValues(
	values: readonly LookupValue[],
	added: readonly { label: string; code?: string }[]
): ValuesEdit {
	const taken = new Set(
		values.flatMap((v) => [v.value.toLowerCase(), labelOfValue(v).toLowerCase()])
	);
	const next = [...values];
	for (const { label, code } of added) {
		const text = label.trim();
		if (!text || taken.has(text.toLowerCase())) continue;
		taken.add(text.toLowerCase());
		next.push({ value: text, ...(code?.trim() ? { code: code.trim() } : {}) });
	}
	if (next.length === values.length) {
		return added.length === 1
			? `${added[0]!.label.trim()} is already in the list`
			: 'Those values are already in the list';
	}
	return next;
}

/** Changes how a value reads. The stored value stays, so cases that hold it keep it. */
export function relabelValue(
	values: readonly LookupValue[],
	value: string,
	label: string
): ValuesEdit {
	const text = label.trim();
	if (!text) return 'A value needs a name';
	const clash = values.find(
		(v) => v.value !== value && labelOfValue(v).toLowerCase() === text.toLowerCase()
	);
	if (clash) return `${text} is already in the list`;
	return values.map((v) => {
		if (v.value !== value) return v;
		const rest = omit(v, 'label');
		return text === v.value ? rest : { ...rest, label: text };
	});
}

/** Sets or clears a value's code. */
export function setValueCode(
	values: readonly LookupValue[],
	value: string,
	code: string
): ValuesEdit {
	const text = code.trim();
	return values.map((v) => {
		if (v.value !== value) return v;
		const rest = omit(v, 'code');
		return text ? { ...rest, code: text } : rest;
	});
}

/** Sets or clears what a value means. */
export function setValueDescription(
	values: readonly LookupValue[],
	value: string,
	description: string
): ValuesEdit {
	const text = description.trim();
	return values.map((v) => {
		if (v.value !== value) return v;
		const rest = omit(v, 'description');
		return text ? { ...rest, description: text } : rest;
	});
}

/** Turns a value off, so it is no longer offered, or back on. */
export function setValueDisabled(
	values: readonly LookupValue[],
	value: string,
	disabled: boolean
): ValuesEdit {
	return values.map((v) => {
		if (v.value !== value) return v;
		const rest = omit(v, 'disabled');
		return disabled ? { ...rest, disabled: true } : rest;
	});
}

/** Moves a value to position `to`, counted in the list without it. */
export function moveValue(values: readonly LookupValue[], value: string, to: number): ValuesEdit {
	const from = values.findIndex((v) => v.value === value);
	if (from === -1) return `${value} is not in the list`;
	const rest = values.filter((_v, i) => i !== from);
	const at = Math.max(0, Math.min(to, rest.length));
	if (at === from) return values.slice();
	return rest.toSpliced(at, 0, values[from]!);
}

/** Takes a value out of the list. Cases that already hold it keep it. */
export function removeValue(values: readonly LookupValue[], value: string): ValuesEdit {
	return values.filter((v) => v.value !== value);
}

/** Sorts values A to Z by how they read, turned-off ones last. */
export function sortValues(values: readonly LookupValue[]): LookupValue[] {
	return values.toSorted(
		(a, b) =>
			Number(!!a.disabled) - Number(!!b.disabled) ||
			labelOfValue(a).localeCompare(labelOfValue(b), 'en', { numeric: true, sensitivity: 'base' })
	);
}

/**
 * What changed between two versions of a list of values, in plain words, such as
 * `added SEV5; renamed SEV1 to Critical; turned off SEV4`. Empty when nothing did.
 */
export function describeValueChanges(
	before: readonly LookupValue[],
	after: readonly LookupValue[]
): string[] {
	const was = new Map(before.map((v) => [v.value, v]));
	const now = new Map(after.map((v) => [v.value, v]));
	const parts: string[] = [];
	const added = after.filter((v) => !was.has(v.value)).map(labelOfValue);
	const removed = before.filter((v) => !now.has(v.value)).map(labelOfValue);
	if (added.length) parts.push(`added ${list(added)}`);
	if (removed.length) parts.push(`removed ${list(removed)}`);
	const kept = after.filter((v) => was.has(v.value));
	for (const v of kept) {
		const old = was.get(v.value)!;
		if (labelOfValue(old) !== labelOfValue(v)) {
			parts.push(`renamed ${labelOfValue(old)} to ${labelOfValue(v)}`);
		}
		if (old.code !== v.code) {
			parts.push(
				v.code === undefined
					? `removed the code of ${labelOfValue(v)}`
					: `set the code of ${labelOfValue(v)} to ${v.code}`
			);
		}
		if (old.description !== v.description) {
			parts.push(`changed what ${labelOfValue(v)} means`);
		}
		if (!!old.disabled !== !!v.disabled) {
			parts.push(`turned ${v.disabled ? 'off' : 'on'} ${labelOfValue(v)}`);
		}
	}
	const order = (items: readonly LookupValue[], keep: Map<string, LookupValue>) =>
		items.filter((v) => keep.has(v.value)).map((v) => v.value);
	if (order(before, now).join('\n') !== order(after, was).join('\n'))
		parts.push('reordered the values');
	return parts;
}

/** A new lookup node's id from its title, numbered when already taken. */
export function freshLookupId(document: DefinitionDocument, title: string): LookupId {
	const taken = new Set(document.nodes.map((n) => n.core.id));
	const base =
		title
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '') || 'list';
	let id = `lookup.${base}` as LookupId;
	for (let n = 2; taken.has(id); n++) id = `lookup.${base}-${n}` as LookupId;
	return id;
}

/** A lookup node of `title` with `values`. */
export function newLookupNode(id: LookupId, title: string, values: LookupValue[]): Node {
	const core: LookupCore = { id, kind: 'lookup', title, values };
	return { core };
}

/** Where a fact's choices should come from, for `choicesPatch`. */
export type ChoicesFrom =
	| { kind: 'own'; options: string[] }
	| { kind: 'lookup'; lookup: LookupId }
	| { kind: 'shared'; name: string };

/**
 * The `update_core` changes to a fact's schema that make its choices come from `to`, clearing
 * what the old source left behind, since a merge patch would otherwise keep it. A list fact keeps
 * its own options on its items.
 */
export function choicesPatch(schema: FactSchema, to: ChoicesFrom): Record<string, unknown> {
	const list = schema.type === 'array';
	const options = (enumValue: string[] | null) =>
		list ? { items: { type: 'string', enum: enumValue } } : { enum: enumValue };
	const old = schema['x-lookup'];
	const cleared = old
		? Object.fromEntries(Object.keys(old).map((key) => [key, null]))
		: ({} as Record<string, null>);
	switch (to.kind) {
		case 'own':
			return { 'x-lookup': null, ...options(to.options) };
		case 'lookup':
			return { 'x-lookup': { ...cleared, kind: 'lookup', lookup: to.lookup }, ...options(null) };
		case 'shared':
			return { 'x-lookup': { ...cleared, kind: 'dataset', dataset: to.name }, ...options(null) };
	}
}

/**
 * Why a value is not a valid shared lookup body, in plain language, or undefined when it is: it
 * needs a title and values shaped as a lookup node's, each stored value listed once.
 */
export function lookupListProblem(list: unknown): string | undefined {
	const isText = (v: unknown) => typeof v === 'string' && v.trim() !== '';
	if (typeof list !== 'object' || list === null || Array.isArray(list)) {
		return 'A lookup needs a title and values';
	}
	const { title, values, content, ...rest } = list as Record<string, unknown>;
	const unknown = Object.keys(rest);
	if (unknown.length) return `A lookup has no field "${unknown[0]}"`;
	if (!isText(title)) return 'A lookup needs a name';
	if (content !== undefined && typeof content !== 'string') return 'Its guidance must be text';
	if (!Array.isArray(values)) return 'A lookup needs a list of values';
	const seen = new Set<string>();
	for (const v of values as unknown[]) {
		if (typeof v !== 'object' || v === null || Array.isArray(v))
			return 'Each value must be an object';
		const { value, label, code, description, disabled, ...extra } = v as Record<string, unknown>;
		if (Object.keys(extra).length) return `A value has no field "${Object.keys(extra)[0]}"`;
		if (!isText(value)) return 'Every value needs a name';
		if (label !== undefined && !isText(label))
			return `The label of ${String(value)} cannot be empty`;
		if (code !== undefined && !isText(code)) return `The code of ${String(value)} cannot be empty`;
		if (description !== undefined && !isText(description)) {
			return `The meaning of ${String(value)} cannot be empty`;
		}
		if (disabled !== undefined && typeof disabled !== 'boolean') {
			return `Whether ${String(value)} is turned off must be true or false`;
		}
		if (seen.has(value as string)) return `${String(value)} is in the list twice`;
		seen.add(value as string);
	}
	return undefined;
}

function omit<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
	const copy = { ...value };
	delete copy[key];
	return copy;
}

function list(items: string[]): string {
	return items.length <= 1
		? (items[0] ?? '')
		: `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}
