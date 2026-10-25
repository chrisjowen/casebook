import type { ActorPolicy, Collect, DefinitionDocument, Guard, Node, NodeKind } from '../node.js';
import { formatField } from '../pointer.js';
import { isEqual, isRecord } from './json.js';

/**
 * Structured, plain-language differences between two versions of a definition, such as two draft
 * revisions. The wizard shows these as the accept/reject view of an agent turn (ADR 0011).
 */

export const DOCUMENT_FIELDS = [
	'$schema',
	'schemaVersion',
	'namespace',
	'slug',
	'version'
] as const;

export type DocumentField = (typeof DOCUMENT_FIELDS)[number];

export type Change =
	| { type: 'node-added'; nodeId: string; kind: NodeKind; node: Node; summary: string }
	| { type: 'node-removed'; nodeId: string; kind: NodeKind; node: Node; summary: string }
	| {
			type: 'node-changed';
			nodeId: string;
			kind: NodeKind;
			/** The field that changed, such as `core.stage`, `content` or `data["ui.icon"]`. */
			field: string;
			/** Absent when the field was added. */
			before?: unknown;
			/** Absent when the field was removed. */
			after?: unknown;
			summary: string;
	  }
	| {
			/** Stages run in the order they appear, so their order is part of the definition. */
			type: 'stages-reordered';
			before: string[];
			after: string[];
			summary: string;
	  }
	| {
			type: 'document-changed';
			field: DocumentField;
			before?: unknown;
			after?: unknown;
			summary: string;
	  };

/**
 * Lists what changed from `before` to `after`: document fields, then added and changed nodes in
 * the order of `after`, then removed nodes, then a reordering of stages. Nodes are matched by id;
 * reordering other nodes is not a change, but stages run in their order, so moving one is.
 * Each node change covers one top-level core field, the content, or one data key.
 */
export function diff(before: DefinitionDocument, after: DefinitionDocument): Change[] {
	const changes: Change[] = [];
	for (const field of DOCUMENT_FIELDS) {
		const [a, b] = [before[field], after[field]];
		if (isEqual(a, b)) continue;
		changes.push({
			type: 'document-changed',
			field,
			...present('before', a),
			...present('after', b),
			summary: describeDocumentChange(field, a, b)
		});
	}

	const label = labeller(before, after);
	const old = new Map(before.nodes.map((n) => [n.core.id, n]));
	const kept = new Set(after.nodes.map((n) => n.core.id));
	for (const node of after.nodes) {
		const { id, kind } = node.core;
		const previous = old.get(id);
		if (previous === undefined) {
			changes.push({ type: 'node-added', nodeId: id, kind, node, summary: `Added ${label(id)}` });
			continue;
		}
		for (const [field, a, b] of fieldsOf(previous, node)) {
			if (isEqual(a, b)) continue;
			changes.push({
				type: 'node-changed',
				nodeId: id,
				kind,
				field: formatField(field),
				...present('before', a),
				...present('after', b),
				summary: capitalise(describeNodeChange(label, id, field, a, b))
			});
		}
	}
	for (const node of before.nodes) {
		const { id, kind } = node.core;
		if (!kept.has(id)) {
			changes.push({
				type: 'node-removed',
				nodeId: id,
				kind,
				node,
				summary: `Removed ${label(id)}`
			});
		}
	}
	const stagesOf = (d: DefinitionDocument, others: DefinitionDocument) => {
		const shared = new Set(others.nodes.map((n) => n.core.id));
		return d.nodes
			.filter((n) => n.core.kind === 'stage' && shared.has(n.core.id))
			.map((n) => n.core.id);
	};
	const [was, now] = [stagesOf(before, after), stagesOf(after, before)];
	if (!isEqual(was, now)) {
		const title = (id: string) => label(id).replace(/^stage /, '');
		changes.push({
			type: 'stages-reordered',
			before: was,
			after: now,
			summary: `Reordered stages: ${now.map(title).join(', ')}`
		});
	}
	return changes;
}

/** The summary lines of a diff, one per change. */
export function summarize(changes: readonly Change[]): string[] {
	return changes.map((c) => c.summary);
}

type Field = [segments: string[], before: unknown, after: unknown];

function fieldsOf(a: Node, b: Node): Field[] {
	const fields: Field[] = [];
	const coreA = a.core as unknown as Record<string, unknown>;
	const coreB = b.core as unknown as Record<string, unknown>;
	for (const key of unionKeys(coreA, coreB)) {
		if (key !== 'id' && key !== 'kind') fields.push([['core', key], coreA[key], coreB[key]]);
	}
	fields.push([['content'], a.content, b.content]);
	const dataA = a.data ?? {};
	const dataB = b.data ?? {};
	for (const key of unionKeys(dataA, dataB)) fields.push([['data', key], dataA[key], dataB[key]]);
	return fields;
}

function unionKeys(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
	return [...new Set([...Object.keys(a), ...Object.keys(b)])];
}

/** Names a node by kind and title, such as `step Notify downstream teams`, preferring `after`. */
function labeller(before: DefinitionDocument, after: DefinitionDocument) {
	const nodes = new Map<string, Node>([...before.nodes, ...after.nodes].map((n) => [n.core.id, n]));
	return (id: unknown): string => {
		const node = typeof id === 'string' ? nodes.get(id) : undefined;
		if (node === undefined) return String(id);
		return `${node.core.kind} ${node.core.title ?? node.core.id}`;
	};
}

type Label = ReturnType<typeof labeller>;

function describeNodeChange(
	label: Label,
	id: string,
	[layer, key]: string[],
	a: unknown,
	b: unknown
): string {
	const node = label(id);
	if (layer === 'content') {
		if (a === undefined) return `Added guidance to ${node}`;
		if (b === undefined) return `Removed the guidance from ${node}`;
		return `Changed the guidance on ${node}`;
	}
	if (layer === 'data') {
		if (a === undefined) return `Set ${key} on ${node}`;
		if (b === undefined) return `Removed ${key} from ${node}`;
		return `Changed ${key} on ${node}`;
	}
	switch (key) {
		case 'title':
			return `Renamed ${id.split('.')[0]} ${String(a ?? id)} to ${String(b ?? id)}`;
		case 'stage':
			return `Moved ${node} from ${label(a)} to ${label(b)}`;
		case 'role':
			return `Changed the role of ${node} from ${label(a)} to ${label(b)}`;
		case 'actor':
			return `Changed who may do ${node} from ${actorText(a)} to ${actorText(b)}`;
		case 'requires': {
			const parts = memberChanges('now requires', 'no longer requires', ids(a), ids(b), label);
			return parts.length === 0
				? `Reordered the facts ${node} requires`
				: `${node} ${parts.join(' and ')}`;
		}
		case 'collects':
			return describeCollects(label, node, collectsOf(a), collectsOf(b));
		case 'approval':
			if (a === undefined) return `${node} now needs ${label(b)}`;
			if (b === undefined) return `${node} no longer needs ${label(a)}`;
			return `${node} now needs ${label(b)} instead of ${label(a)}`;
		case 'outcome':
			return `Changed the outcome of ${node} from ${label(a)} to ${label(b)}`;
		case 'when':
			if (a === undefined) return `Added a condition to ${node}: ${guardText(b)}`;
			if (b === undefined) return `Removed the condition from ${node}`;
			return `Changed the condition on ${node} to ${guardText(b)}`;
		case 'repeat': {
			const until = isRecord(b) ? guardText(b.until) : '';
			if (a === undefined) return `Made ${node} repeat until ${until}`;
			if (b === undefined) return `${node} no longer repeats`;
			return `Changed how ${node} repeats: until ${until}`;
		}
		case 'schema':
			return `Changed the value type of ${node}`;
		case 'scope':
			return `Changed the scope of ${node} from ${String(a ?? 'unset')} to ${String(b ?? 'unset')}`;
		case 'evidence':
			return `Changed the evidence ${node} requires`;
		case 'assigns':
			return `Changed the roles ${node} assigns`;
		case 'source':
			return `Changed the source reference of ${node}`;
		case 'invariants':
			return `Changed the invariants of ${node}`;
		default:
			if (a === undefined) return `Set ${String(key)} on ${node}`;
			if (b === undefined) return `Removed ${String(key)} from ${node}`;
			return `Changed ${String(key)} on ${node}`;
	}
}

function describeCollects(label: Label, node: string, a: Collect[], b: Collect[]): string {
	const byFact = (items: Collect[]) => new Map(items.map((c) => [c.fact, c.by]));
	const [was, now] = [byFact(a), byFact(b)];
	const recorder = [...now.keys()].filter(
		(fact) => was.has(fact) && was.get(fact) !== now.get(fact)
	);
	const parts = memberChanges(
		'now collects',
		'no longer collects',
		[...was.keys()],
		[...now.keys()],
		label
	);
	const recorders = recorder.length > 0 ? `who records ${list(recorder.map(label))}` : undefined;
	if (parts.length === 0) {
		return recorders === undefined
			? `Reordered what ${node} collects`
			: `Changed ${recorders} in ${node}`;
	}
	return `${node} ${parts.join(' and ')}${recorders === undefined ? '' : `, and changed ${recorders}`}`;
}

/** Phrases the members added to and removed from a list, such as `now requires fact A`. */
function memberChanges(
	addedVerb: string,
	removedVerb: string,
	a: string[],
	b: string[],
	label: Label
): string[] {
	const added = b.filter((id) => !a.includes(id)).map(label);
	const removed = a.filter((id) => !b.includes(id)).map(label);
	return [
		...(added.length > 0 ? [`${addedVerb} ${list(added)}`] : []),
		...(removed.length > 0 ? [`${removedVerb} ${list(removed)}`] : [])
	];
}

function describeDocumentChange(field: DocumentField, a: unknown, b: unknown): string {
	switch (field) {
		case 'version':
			return `Changed the version from ${String(a)} to ${String(b)}`;
		case 'namespace':
			return `Moved the definition from namespace ${String(a)} to ${String(b)}`;
		case 'slug':
			return `Changed the slug from ${String(a)} to ${String(b)}`;
		default:
			return `Changed ${field} from ${JSON.stringify(a)} to ${JSON.stringify(b)}`;
	}
}

const ACTOR_TEXT: Record<ActorPolicy, string> = {
	human: 'people only',
	agent: 'agents only',
	either: 'people or agents'
};

function actorText(actor: unknown): string {
	return ACTOR_TEXT[actor as ActorPolicy] ?? String(actor);
}

function guardText(guard: unknown): string {
	return `"${(guard as Guard | undefined)?.text ?? ''}"`;
}

function ids(value: unknown): string[] {
	return Array.isArray(value) ? value.map(String) : [];
}

function collectsOf(value: unknown): Collect[] {
	return Array.isArray(value) ? (value as Collect[]) : [];
}

function list(items: string[]): string {
	return items.length <= 1
		? (items[0] ?? '')
		: `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

function capitalise(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}

function present<K extends string>(key: K, value: unknown): Partial<Record<K, unknown>> {
	return value === undefined ? {} : ({ [key]: value } as Record<K, unknown>);
}
