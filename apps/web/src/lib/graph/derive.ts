/**
 * Graph derivation over process definitions. Edges are never stored: a hand-off runs from the
 * step or decision that collects a fact to every step, decision or approval that requires it
 * (ADR 0003). Everything here is pure so it can be tested without a browser.
 */
import type {
	ApprovalNode,
	DecisionNode,
	DefinitionDocument,
	EvidenceRequirement,
	FactId,
	FactNode,
	FactSchema,
	Node,
	ProcessNode,
	RoleNode,
	StageNode,
	StepNode
} from '@casebook/model';

/** Steps and decisions are the work items placed in stages and drawn as cards. */
export type WorkItem = StepNode | DecisionNode;

export interface ProcessIndex {
	document: DefinitionDocument;
	process: ProcessNode | undefined;
	byId: Map<string, Node>;
	stages: StageNode[];
	roles: RoleNode[];
	facts: FactNode[];
	work: WorkItem[];
	approvals: ApprovalNode[];
}

export function indexDocument(document: DefinitionDocument): ProcessIndex {
	const byId = new Map<string, Node>();
	const ix: ProcessIndex = {
		document,
		process: undefined,
		byId,
		stages: [],
		roles: [],
		facts: [],
		work: [],
		approvals: []
	};
	for (const node of document.nodes) {
		byId.set(node.core.id, node);
		switch (node.core.kind) {
			case 'process':
				ix.process ??= node as ProcessNode;
				break;
			case 'stage':
				ix.stages.push(node as StageNode);
				break;
			case 'role':
				ix.roles.push(node as RoleNode);
				break;
			case 'fact':
				ix.facts.push(node as FactNode);
				break;
			case 'step':
			case 'decision':
				ix.work.push(node as WorkItem);
				break;
			case 'approval':
				ix.approvals.push(node as ApprovalNode);
				break;
		}
	}
	return ix;
}

/** "step.form-working-group" reads as "Form working group". */
export function humanizeId(id: string): string {
	const slug = id.includes('.') ? id.slice(id.indexOf('.') + 1) : id;
	const text = slug.replaceAll('-', ' ');
	return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The plain-language name of a node: its title, or its id made readable. */
export function labelOf(ix: ProcessIndex, id: string | undefined): string {
	if (!id) return 'Unknown';
	const node = ix.byId.get(id);
	return node?.core.title ?? humanizeId(id);
}

/** Facts a work item records: a step's collects, or a decision's outcome. */
export function collectsOf(item: WorkItem): { fact: FactId; by?: string }[] {
	return item.core.kind === 'step' ? (item.core.collects ?? []) : [{ fact: item.core.outcome }];
}

export function requiresOf(item: WorkItem | ApprovalNode): FactId[] {
	return item.core.requires ?? [];
}

export interface HandOff {
	id: string;
	from: string;
	to: string;
	facts: FactId[];
}

/** Hand-offs between work items in one definition, one per (collector, requirer) pair. */
export function handOffs(ix: ProcessIndex): HandOff[] {
	const collectors = collectorsByFact(ix);
	const edges = new Map<string, HandOff>();
	for (const item of ix.work) {
		for (const fact of requiresOf(item)) {
			for (const from of collectors.get(fact) ?? []) {
				if (from === item.core.id) continue;
				const id = `${from}->${item.core.id}`;
				const edge = edges.get(id) ?? { id, from, to: item.core.id, facts: [] };
				if (!edge.facts.includes(fact)) edge.facts.push(fact);
				edges.set(id, edge);
			}
		}
	}
	return [...edges.values()];
}

export function collectorsByFact(ix: ProcessIndex): Map<FactId, string[]> {
	const map = new Map<FactId, string[]>();
	for (const item of ix.work)
		for (const { fact } of collectsOf(item))
			map.set(fact, [...(map.get(fact) ?? []), item.core.id]);
	return map;
}

/**
 * Drops a -> c when a longer path a -> ... -> c exists. Display only: the inspector still lists
 * every input, but the canvas avoids lines from hub steps to almost everything.
 */
export function reduceTransitive<T extends { from: string; to: string }>(edges: T[]): T[] {
	const next = new Map<string, string[]>();
	for (const e of edges) next.set(e.from, [...(next.get(e.from) ?? []), e.to]);
	const reachableAvoidingDirect = (from: string, to: string) => {
		const stack = (next.get(from) ?? []).filter((n) => n !== to);
		const seen = new Set<string>();
		while (stack.length) {
			const n = stack.pop()!;
			if (n === to) return true;
			if (seen.has(n)) continue;
			seen.add(n);
			stack.push(...(next.get(n) ?? []));
		}
		return false;
	};
	return edges.filter((e) => !reachableAvoidingDirect(e.from, e.to));
}

/** Required facts nothing in the definition collects. Publish checks report these as errors. */
export function missingInputs(ix: ProcessIndex, item: WorkItem): FactId[] {
	const collectors = collectorsByFact(ix);
	return requiresOf(item).filter((f) => !collectors.has(f));
}

// ---------------------------------------------------------------------------
// Role lanes: dependency rank per work item, one lane per role, stacked on collisions
// ---------------------------------------------------------------------------

export interface LaneCell {
	id: string;
	col: number;
	row: number;
}

export interface Lane {
	role: string;
	cells: LaneCell[];
	rows: number;
}

export interface LaneGrid {
	lanes: Lane[];
	cols: number;
}

export function laneGrid(ix: ProcessIndex): LaneGrid {
	const edges = handOffs(ix);
	const preds = new Map<string, string[]>();
	for (const e of edges) preds.set(e.to, [...(preds.get(e.to) ?? []), e.from]);
	const stageOrder = new Map(ix.stages.map((s, i) => [s.core.id, i]));
	const rank = new Map<string, number>();

	// longest path from the start, guarding against cycles (publish checks report those)
	const visit = (id: string, trail: Set<string>): number => {
		const known = rank.get(id);
		if (known !== undefined) return known;
		if (trail.has(id)) return 0;
		trail.add(id);
		const r = Math.max(-1, ...(preds.get(id) ?? []).map((p) => visit(p, trail))) + 1;
		trail.delete(id);
		rank.set(id, r);
		return r;
	};
	for (const item of ix.work) visit(item.core.id, new Set());

	// a later stage never starts left of an earlier one
	const byStage = [...ix.work].sort(
		(a, b) => (stageOrder.get(a.core.stage) ?? 0) - (stageOrder.get(b.core.stage) ?? 0)
	);
	let floor = 0;
	let stage: string | undefined;
	let stageMax = -1;
	for (const item of byStage) {
		if (item.core.stage !== stage) {
			floor = stageMax + 1;
			stage = item.core.stage;
		}
		const r = Math.max(rank.get(item.core.id)!, floor);
		rank.set(item.core.id, r);
		stageMax = Math.max(stageMax, r);
	}
	for (let pass = 0; pass < ix.work.length; pass++)
		for (const e of edges) {
			const from = rank.get(e.from)!;
			if (rank.get(e.to)! <= from) rank.set(e.to, from + 1);
		}

	const lanes: Lane[] = [];
	for (const role of ix.roles) {
		const items = ix.work.filter((w) => w.core.role === role.core.id);
		if (!items.length) continue;
		const used = new Map<number, number>();
		const cells = items.map((w) => {
			const col = rank.get(w.core.id)!;
			const row = used.get(col) ?? 0;
			used.set(col, row + 1);
			return { id: w.core.id, col, row };
		});
		lanes.push({ role: role.core.id, cells, rows: Math.max(1, ...used.values()) });
	}
	return { lanes, cols: Math.max(0, ...rank.values()) + 1 };
}

// ---------------------------------------------------------------------------
// Fact flow: facts and work items are both nodes
// ---------------------------------------------------------------------------

export interface FlowEdge {
	id: string;
	source: string;
	target: string;
	kind: 'collects' | 'requires';
}

export interface FactFlow {
	work: string[];
	facts: FactId[];
	edges: FlowEdge[];
}

export function factFlow(ix: ProcessIndex): FactFlow {
	const facts = new Set<FactId>();
	const edges: FlowEdge[] = [];
	for (const item of ix.work) {
		for (const { fact } of collectsOf(item)) {
			facts.add(fact);
			edges.push({
				id: `${item.core.id}=>${fact}`,
				source: item.core.id,
				target: `fact:${fact}`,
				kind: 'collects'
			});
		}
		for (const fact of requiresOf(item)) {
			facts.add(fact);
			edges.push({
				id: `${fact}=>${item.core.id}`,
				source: `fact:${fact}`,
				target: item.core.id,
				kind: 'requires'
			});
		}
	}
	return { work: ix.work.map((w) => w.core.id), facts: [...facts], edges };
}

// ---------------------------------------------------------------------------
// Workspace map: processes linked by the fact types they share
// ---------------------------------------------------------------------------

export interface SharedFactType {
	id: FactId;
	title: string;
	uses: { slug: string; process: string; collectedBy: string[]; neededBy: string[] }[];
}

/** Fact types declared by more than one definition in a workspace. */
export function sharedFactTypes(documents: DefinitionDocument[]): SharedFactType[] {
	const out = new Map<FactId, SharedFactType>();
	const indexes = documents.map(indexDocument);
	for (const ix of indexes)
		for (const fact of ix.facts) {
			const entry = out.get(fact.core.id) ?? {
				id: fact.core.id,
				title: labelOf(ix, fact.core.id),
				uses: []
			};
			entry.uses.push({
				slug: ix.document.slug,
				process: labelOf(ix, ix.process?.core.id),
				collectedBy: ix.work
					.filter((w) => collectsOf(w).some((c) => c.fact === fact.core.id))
					.map((w) => labelOf(ix, w.core.id)),
				neededBy: ix.work
					.filter((w) => requiresOf(w).includes(fact.core.id))
					.map((w) => labelOf(ix, w.core.id))
			});
			out.set(fact.core.id, entry);
		}
	return [...out.values()].filter((f) => f.uses.length > 1);
}

export interface ProcessLink {
	id: string;
	from: string;
	to: string;
	facts: string[];
}

/** Definition A links to B when A collects a fact type that B requires but does not collect. */
export function processLinks(documents: DefinitionDocument[]): ProcessLink[] {
	const indexes = documents.map(indexDocument);
	const links = new Map<string, ProcessLink>();
	for (const consumer of indexes) {
		const own = collectorsByFact(consumer);
		for (const item of consumer.work)
			for (const fact of requiresOf(item)) {
				if (own.has(fact)) continue;
				for (const producer of indexes) {
					if (producer === consumer || !collectorsByFact(producer).has(fact)) continue;
					const id = `${producer.document.slug}->${consumer.document.slug}`;
					const link = links.get(id) ?? {
						id,
						from: producer.document.slug,
						to: consumer.document.slug,
						facts: []
					};
					const title = labelOf(producer, fact);
					if (!link.facts.includes(title)) link.facts.push(title);
					links.set(id, link);
				}
			}
	}
	return [...links.values()];
}

// ---------------------------------------------------------------------------
// Plain-language helpers
// ---------------------------------------------------------------------------

export type FactGlyph =
	| 'text'
	| 'number'
	| 'yesno'
	| 'date'
	| 'choice'
	| 'document'
	| 'people'
	| 'lookup'
	| 'list'
	| 'link'
	| 'record';

/** A fact type's kind in plain words, from its JSON Schema and casebook extensions (ADR 0006). */
export function factType(schema: FactSchema | undefined): { label: string; glyph: FactGlyph } {
	if (!schema) return { label: 'Unknown', glyph: 'text' };
	const lookup = schema['x-lookup'];
	if (schema['x-evidence']) return { label: 'Document', glyph: 'document' };
	if (lookup?.kind === 'principal') return { label: 'People', glyph: 'people' };
	if (lookup) return { label: 'Lookup', glyph: 'lookup' };
	if (Array.isArray(schema.enum)) return { label: 'Choice', glyph: 'choice' };
	if (schema.format === 'date') return { label: 'Date', glyph: 'date' };
	if (schema.format === 'date-time') return { label: 'Date & time', glyph: 'date' };
	if (schema.format === 'uri') return { label: 'Link', glyph: 'link' };
	switch (schema.type) {
		case 'number':
		case 'integer':
			return { label: 'Number', glyph: 'number' };
		case 'boolean':
			return { label: 'Yes or no', glyph: 'yesno' };
		case 'array':
			return { label: 'List', glyph: 'list' };
		case 'object':
			return { label: 'Record', glyph: 'record' };
		default:
			return { label: 'Text', glyph: 'text' };
	}
}

const DURATION = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

/** "PT30M" reads as "30 minutes"; anything unrecognised is returned unchanged. */
export function humanizeDuration(iso: string): string {
	const m = DURATION.exec(iso);
	if (!m) return iso;
	const parts = (
		[
			[m[1], 'day'],
			[m[2], 'hour'],
			[m[3], 'minute'],
			[m[4], 'second']
		] as const
	)
		.filter(([n]) => n && Number(n) > 0)
		.map(([n, unit]) => `${Number(n)} ${unit}${Number(n) === 1 ? '' : 's'}`);
	return parts.join(' ') || iso;
}

/** Evidence wording: "Original or certified copy, 2 copies". */
export function describeEvidence(e: EvidenceRequirement): string {
	const formats = (e.formats ?? []).map((f) => f.replaceAll('-', ' '));
	const what = formats.length ? formats.join(' or ') : e.description;
	const text = what.charAt(0).toUpperCase() + what.slice(1);
	return e.copies && e.copies > 1 ? `${text}, ${e.copies} copies` : text;
}

/** The evidence a work item asks for a fact: its own requirement, else the fact type's default. */
export function evidenceFor(
	ix: ProcessIndex,
	item: WorkItem,
	fact: FactId
): EvidenceRequirement | undefined {
	if (item.core.kind === 'step') {
		const own = item.core.evidence?.find((e) => e.fact === fact);
		if (own) return own;
	}
	const node = ix.byId.get(fact) as FactNode | undefined;
	return node?.core.schema['x-evidence'];
}

const NODE_ID = /\b(?:process|stage|step|fact|role|decision|approval)\.[a-z0-9]+(?:-[a-z0-9]+)*/g;

/** Replaces node ids in a model message with the nodes' plain names. */
export function plainText(ix: ProcessIndex, message: string): string {
	return message.replace(NODE_ID, (id) => `“${labelOf(ix, id)}”`);
}
