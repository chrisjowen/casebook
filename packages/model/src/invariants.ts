import type { DefinitionDocument, Node, NodeKind } from './node.js';
import { formatField, toPointer, type Segments } from './pointer.js';
import { nodeReferences, type NodeReference } from './references.js';
import { validate, type ValidationError } from './validate.js';

export const ISSUE_SEVERITIES = ['error', 'warning'] as const;

/** Errors block publishing; warnings are shown but do not. */
export type IssueSeverity = (typeof ISSUE_SEVERITIES)[number];

export const INVARIANT_CODES = [
	'duplicate-id',
	'missing-process',
	'multiple-processes',
	'unknown-stage',
	'unknown-fact',
	'unknown-approval',
	'undeclared-role',
	'unknown-guard-fact',
	'uncollected-fact',
	'dependency-cycle',
	'uncollected-read-fact',
	'unused-fact',
	'empty-stage'
] as const;

export type InvariantCode = (typeof INVARIANT_CODES)[number];

/** A publish-time invariant violation (ADR 0005). */
export interface InvariantIssue {
	code: InvariantCode;
	severity: IssueSeverity;
	/** JSON Pointer to the field at fault, such as `/nodes/4/core/requires/1`. */
	path: string;
	/** Id of the node at fault. Absent only for problems with the document as a whole. */
	nodeId?: string;
	message: string;
	/** Other nodes involved, such as the rest of a dependency cycle. */
	related?: string[];
}

interface Reference extends NodeReference {
	/** Index of the node holding the reference. */
	node: number;
}

interface Edge {
	from: number;
	to: number;
	fact: string;
}

const WORK_KINDS: ReadonlySet<NodeKind> = new Set(['step', 'decision', 'approval']);

/**
 * Runs the publish-time invariant checks (ADR 0005) on a schema-valid document: no dependency
 * cycles, every required fact collected, every role declared, every guard expression referencing
 * only declared facts, plus referential integrity. Issues are grouped by check, each group in
 * document order.
 */
export function checkInvariants(document: DefinitionDocument): InvariantIssue[] {
	const { nodes } = document;
	const issues: InvariantIssue[] = [];
	const at = (node: number, segments: Segments) => toPointer(['nodes', node, ...segments]);
	const idOf = (node: number) => nodes[node]?.core.id ?? `node ${node}`;

	const declared = new Map<string, number>();
	nodes.forEach((node, i) => {
		const first = declared.get(node.core.id);
		if (first === undefined) {
			declared.set(node.core.id, i);
			return;
		}
		issues.push({
			code: 'duplicate-id',
			severity: 'error',
			path: at(i, ['core', 'id']),
			nodeId: node.core.id,
			message: `${node.core.id} is declared more than once (nodes ${first} and ${i}); ids must be unique`
		});
	});
	const isDeclared = (id: string, kind: NodeKind) => {
		const index = declared.get(id);
		return index !== undefined && nodes[index]?.core.kind === kind;
	};

	const processes = nodes.flatMap((node, i) => (node.core.kind === 'process' ? [i] : []));
	if (processes.length === 0) {
		issues.push({
			code: 'missing-process',
			severity: 'error',
			path: '/nodes',
			message: 'the definition has no process node; add exactly one'
		});
	}
	for (const i of processes.slice(1)) {
		issues.push({
			code: 'multiple-processes',
			severity: 'error',
			path: at(i, ['core', 'kind']),
			nodeId: idOf(i),
			message: `${idOf(i)} is a second process node; a definition describes exactly one process (the first is ${idOf(processes[0] ?? 0)})`
		});
	}

	const references: Reference[] = nodes.flatMap((node, i) =>
		nodeReferences(node).map((ref) => ({ ...ref, node: i }))
	);

	for (const ref of references) {
		if (isDeclared(ref.target, ref.kind)) continue;
		const field = formatField(ref.at);
		const where = ref.inGuard
			? `${idOf(ref.node)} has a guard (${field}) that refers to`
			: `${idOf(ref.node)} ${field} refers to`;
		issues.push({
			code: unresolvedCode(ref),
			severity: 'error',
			path: at(ref.node, ref.at),
			nodeId: idOf(ref.node),
			message: `${where} ${ref.target}, which is not declared`
		});
	}

	// Facts collected by a step or decided by a decision, with who produces each.
	const producers = new Map<string, number[]>();
	nodes.forEach((node, i) => {
		for (const fact of producedFacts(node)) {
			producers.set(fact, [...(producers.get(fact) ?? []), i]);
		}
	});

	const factRefs = references.filter((r) => r.kind === 'fact' && isDeclared(r.target, 'fact'));
	for (const [fact, refs] of groupBy(factRefs, (r) => r.target)) {
		if (producers.has(fact)) continue;
		const factIndex = declared.get(fact) ?? 0;
		const requiredBy = unique(refs.filter((r) => r.required).map((r) => idOf(r.node)));
		const readBy = unique(refs.filter((r) => !r.required).map((r) => idOf(r.node)));
		if (requiredBy.length > 0) {
			issues.push({
				code: 'uncollected-fact',
				severity: 'error',
				path: at(factIndex, []),
				nodeId: fact,
				message: `${fact} is required by ${listIds(requiredBy)}, but no step or decision collects it`,
				related: requiredBy
			});
		} else if (readBy.length > 0) {
			issues.push({
				code: 'uncollected-read-fact',
				severity: 'warning',
				path: at(factIndex, []),
				nodeId: fact,
				message: `${fact} is read by ${listIds(readBy)}, but no step or decision collects it`,
				related: readBy
			});
		}
	}

	const usedFacts = new Set(factRefs.map((r) => r.target));
	const usedStages = new Set(references.filter((r) => r.kind === 'stage').map((r) => r.target));
	nodes.forEach((node, i) => {
		if (declared.get(node.core.id) !== i) return;
		if (node.core.kind === 'fact' && !usedFacts.has(node.core.id)) {
			issues.push({
				code: 'unused-fact',
				severity: 'warning',
				path: at(i, []),
				nodeId: node.core.id,
				message: `${node.core.id} is declared but nothing collects, requires or reads it`
			});
		}
		if (node.core.kind === 'stage' && !usedStages.has(node.core.id)) {
			issues.push({
				code: 'empty-stage',
				severity: 'warning',
				path: at(i, []),
				nodeId: node.core.id,
				message: `${node.core.id} has no steps or decisions`
			});
		}
	});

	// A required fact is available once any producer other than the requiring node can start.
	const requiredFacts = new Map<number, string[]>();
	for (const ref of references) {
		if (!ref.required || !WORK_KINDS.has(nodes[ref.node]?.core.kind ?? 'process')) continue;
		requiredFacts.set(ref.node, [...(requiredFacts.get(ref.node) ?? []), ref.target]);
	}
	const startable = new Set(nodes.flatMap((_node, i) => (requiredFacts.has(i) ? [] : [i])));
	const available = (node: number, fact: string) =>
		(producers.get(fact) ?? []).some((p) => p !== node && startable.has(p));
	for (let changed = true; changed;) {
		changed = false;
		for (const [node, facts] of requiredFacts) {
			if (startable.has(node) || !facts.every((fact) => available(node, fact))) continue;
			startable.add(node);
			changed = true;
		}
	}

	// A node that can never start depends on every producer of each fact it is still missing.
	const edges = new Map<number, Edge[]>();
	for (const [node, facts] of requiredFacts) {
		if (startable.has(node)) continue;
		for (const fact of facts) {
			if (available(node, fact)) continue;
			for (const producer of producers.get(fact) ?? []) {
				const edge = { from: node, to: producer, fact };
				edges.set(node, [...(edges.get(node) ?? []), edge]);
			}
		}
	}
	for (const component of stronglyConnected(nodes.length, edges)) {
		const start = Math.min(...component);
		const cycle = cycleThrough(start, edges, new Set(component));
		if (cycle.length === 0) continue;
		const related = [...component].sort((a, b) => a - b).map(idOf);
		const steps = cycle.map((e) =>
			e.from === e.to
				? `${idOf(e.from)} requires ${e.fact}, which it collects itself`
				: `${idOf(e.from)} requires ${e.fact} from ${idOf(e.to)}`
		);
		const requiresIndex = requiresField(nodes[start], cycle[0]?.fact);
		issues.push({
			code: 'dependency-cycle',
			severity: 'error',
			path: at(start, requiresIndex === undefined ? ['core'] : ['core', 'requires', requiresIndex]),
			nodeId: idOf(start),
			message: `dependency cycle: ${steps.join('; ')}. ${related.length === 1 ? `${idOf(start)} can never start` : `None of ${listIds(related)} can start`}`,
			related
		});
	}

	return issues;
}

export interface PublishCheck {
	/** True when the document is schema-valid and has no error-severity invariant issues. */
	ok: boolean;
	errors: ValidationError[];
	/** Invariant issues; empty when schema validation failed, since the checks need a valid shape. */
	issues: InvariantIssue[];
}

/** Validates a document against the schema and, if it is valid, runs the invariant checks. */
export function checkPublish(document: unknown): PublishCheck {
	const result = validate(document);
	if (!result.valid) {
		return { ok: false, errors: result.errors, issues: [] };
	}
	const issues = checkInvariants(result.document);
	return { ok: !issues.some((i) => i.severity === 'error'), errors: [], issues };
}

function producedFacts(node: Node): string[] {
	switch (node.core.kind) {
		case 'step':
			return node.core.collects?.map((c) => c.fact) ?? [];
		case 'decision':
			return [node.core.outcome];
		default:
			return [];
	}
}

function unresolvedCode(ref: Reference): InvariantCode {
	switch (ref.kind) {
		case 'stage':
			return 'unknown-stage';
		case 'role':
			return 'undeclared-role';
		case 'approval':
			return 'unknown-approval';
		case 'fact':
			return ref.inGuard ? 'unknown-guard-fact' : 'unknown-fact';
	}
}

function requiresField(node: Node | undefined, fact: string | undefined): number | undefined {
	if (node === undefined || fact === undefined || !('requires' in node.core)) return undefined;
	const i = (node.core.requires as string[] | undefined)?.indexOf(fact) ?? -1;
	return i === -1 ? undefined : i;
}

/** Tarjan's algorithm. Returns components that contain a cycle: two or more nodes, or a self-loop. */
function stronglyConnected(size: number, edges: Map<number, Edge[]>): number[][] {
	const index = new Array<number | undefined>(size);
	const low = new Array<number>(size).fill(0);
	const onStack = new Array<boolean>(size).fill(false);
	const stack: number[] = [];
	const components: number[][] = [];
	let counter = 0;

	const visit = (v: number) => {
		index[v] = counter;
		low[v] = counter;
		counter += 1;
		stack.push(v);
		onStack[v] = true;
		for (const { to } of edges.get(v) ?? []) {
			if (index[to] === undefined) {
				visit(to);
				low[v] = Math.min(low[v] ?? 0, low[to] ?? 0);
			} else if (onStack[to]) {
				low[v] = Math.min(low[v] ?? 0, index[to] ?? 0);
			}
		}
		if (low[v] !== index[v]) return;
		const component: number[] = [];
		let w: number | undefined;
		do {
			w = stack.pop();
			if (w === undefined) break;
			onStack[w] = false;
			component.push(w);
		} while (w !== v);
		const selfLoop = (edges.get(v) ?? []).some((e) => e.to === v);
		if (component.length > 1 || selfLoop) components.push(component);
	};

	for (let v = 0; v < size; v += 1) {
		if (index[v] === undefined) visit(v);
	}
	return components.sort((a, b) => Math.min(...a) - Math.min(...b));
}

/** Finds one cycle that starts and ends at `start`, using only edges inside `members`. */
function cycleThrough(start: number, edges: Map<number, Edge[]>, members: Set<number>): Edge[] {
	const visited = new Set([start]);
	const path: Edge[] = [];
	const search = (from: number): boolean => {
		for (const edge of edges.get(from) ?? []) {
			if (!members.has(edge.to)) continue;
			path.push(edge);
			if (edge.to === start) return true;
			if (!visited.has(edge.to)) {
				visited.add(edge.to);
				if (search(edge.to)) return true;
			}
			path.pop();
		}
		return false;
	};
	search(start);
	return path;
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
	const groups = new Map<string, T[]>();
	for (const item of items) {
		groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
	}
	return groups;
}

function unique(values: string[]): string[] {
	return [...new Set(values)];
}

function listIds(ids: string[]): string {
	return ids.length <= 1 ? (ids[0] ?? '') : `${ids.slice(0, -1).join(', ')} and ${ids.at(-1)}`;
}
