/**
 * Turns a definition into positioned Svelte Flow nodes and edges for each view. ELK lays out
 * the step cards, fact flow and workspace map; role lanes use the rank grid from `derive.ts`.
 */
import type { Edge, Node } from '@xyflow/svelte';
import type { DefinitionDocument, FactNode } from '@casebook/model';
import {
	collectsOf,
	factFlow,
	factType,
	handOffs,
	humanizeDuration,
	labelOf,
	laneGrid,
	missingInputs,
	processLinks,
	reduceTransitive,
	sharedFactTypes,
	type FactGlyph,
	type ProcessIndex,
	type WorkItem
} from './derive';

export type ViewId = 'cards' | 'lanes' | 'facts';

export const CARD_W = 276;
export const CARD_HEAD = 58;
export const ROW_H = 28;
export const MAX_ROWS = 4;
export const COMPACT_W = 216;
export const COMPACT_H = 76;
const FACT_W = 196;
const FACT_H = 46;
const PROCESS_W = 300;
const PROCESS_H = 150;
const SHARED_W = 250;

// ELK is large, so it loads on first layout rather than with the page.
type Elk = InstanceType<typeof import('elkjs/lib/elk.bundled.js').default>;
let elkInstance: Promise<Elk> | undefined;
const elk = {
	layout: async (graph: Parameters<Elk['layout']>[0]) => {
		elkInstance ??= import('elkjs/lib/elk.bundled.js').then(({ default: ELK }) => new ELK());
		return (await elkInstance).layout(graph);
	}
};

export interface CardData extends Record<string, unknown> {
	id: string;
	kind: 'step' | 'decision';
	title: string;
	roleTitle: string;
	roleTone: number;
	roleExternal: boolean;
	actor: string;
	rows: { id: string; title: string; type: string; glyph: FactGlyph }[];
	moreRows: number;
	/** Plain names of every fact the item collects, including those past the visible rows. */
	facts: string[];
	badge?: string;
	guard?: string;
	repeat?: string;
	approval?: string;
	assigns?: string;
	inferred: boolean;
	missing: number;
	compact: boolean;
	dim?: boolean;
}

export interface FactData extends Record<string, unknown> {
	id: string;
	title: string;
	glyph: FactGlyph;
	sensitive: boolean;
	missing: boolean;
	dim?: boolean;
}

export interface HandOffData extends Record<string, unknown> {
	/** Plain names of the facts carried along the edge. */
	facts: string[];
	points?: { x: number; y: number }[];
	alwaysLabel?: boolean;
	lane?: boolean;
	active?: boolean;
	dim?: boolean;
}

export interface Built {
	nodes: Node[];
	edges: Edge[];
}

const ACTOR_LABEL = { human: 'Person only', agent: 'Agent', either: 'Person or agent' } as const;

/** Stable tint per role, by declaration order. */
export function roleTone(ix: ProcessIndex, roleId: string): number {
	const i = ix.roles.findIndex((r) => r.core.id === roleId);
	return i < 0 ? 0 : i % 6;
}

export function cardData(ix: ProcessIndex, item: WorkItem, compact: boolean): CardData {
	const role = ix.roles.find((r) => r.core.id === item.core.role);
	const collects = collectsOf(item);
	const step = item.core.kind === 'step' ? item.core : undefined;
	return {
		id: item.core.id,
		kind: item.core.kind,
		title: labelOf(ix, item.core.id),
		roleTitle: labelOf(ix, item.core.role),
		roleTone: roleTone(ix, item.core.role),
		roleExternal: role?.core.scope === 'case',
		actor: ACTOR_LABEL[item.core.actor],
		rows: collects.slice(0, MAX_ROWS).map(({ fact }) => {
			const t = factType((ix.byId.get(fact) as FactNode | undefined)?.core.schema);
			return { id: fact, title: labelOf(ix, fact), type: t.label, glyph: t.glyph };
		}),
		moreRows: Math.max(0, collects.length - MAX_ROWS),
		facts: collects.map(({ fact }) => labelOf(ix, fact)),
		badge: item.core.kind === 'decision' ? 'Decision' : undefined,
		guard: item.core.when?.text,
		repeat: step?.repeat?.every
			? `Every ${humanizeDuration(step.repeat.every)}`
			: step?.repeat
				? 'Repeats'
				: undefined,
		approval: step?.approval ? labelOf(ix, step.approval) : undefined,
		assigns: step?.assigns?.length
			? step.assigns.map((a) => labelOf(ix, a.role)).join(', ')
			: undefined,
		inferred: !!item.core.source?.inferred,
		missing: missingInputs(ix, item).length,
		compact
	};
}

/** Full card height: header, inset fact rows, optional footer chips. */
export function cardHeight(d: CardData): number {
	const rows = Math.max(1, d.rows.length) + (d.moreRows ? 1 : 0);
	const footer = d.guard || d.repeat || d.approval || d.inferred || d.assigns ? 34 : 0;
	return CARD_HEAD + rows * ROW_H + 10 + footer + 12;
}

export const rowPortY = (i: number) => CARD_HEAD + 5 + i * ROW_H + ROW_H / 2;

function handOffEdges(ix: ProcessIndex, ported: boolean): Edge[] {
	return reduceTransitive(handOffs(ix)).map((e) => {
		const from = ix.byId.get(e.from) as WorkItem | undefined;
		const visible = from
			? collectsOf(from)
					.slice(0, MAX_ROWS)
					.map((c) => c.fact)
			: [];
		const row = e.facts.find((f) => visible.includes(f));
		return {
			id: e.id,
			source: e.from,
			target: e.to,
			type: 'handoff',
			...(ported ? { sourceHandle: row ? `f:${row}` : 'out', targetHandle: 'in' } : {}),
			data: { facts: e.facts.map((f) => labelOf(ix, f)) } satisfies HandOffData
		};
	});
}

// ---------------------------------------------------------------------------
// ELK plumbing: copy orthogonal routes onto edges in absolute coordinates
// ---------------------------------------------------------------------------

type Pt = { x: number; y: number };
interface ElkOutEdge {
	id: string;
	container?: string;
	sections?: { startPoint: Pt; endPoint: Pt; bendPoints?: Pt[] }[];
}
interface ElkOutNode {
	id: string;
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	children?: ElkOutNode[];
	edges?: ElkOutEdge[];
}

function attachRoutes(out: ElkOutNode, edges: Edge[]) {
	const offset = new Map<string, Pt>([['root', { x: 0, y: 0 }]]);
	const walk = (n: ElkOutNode, base: Pt) => {
		for (const child of n.children ?? []) {
			const o = { x: base.x + (child.x ?? 0), y: base.y + (child.y ?? 0) };
			offset.set(child.id, o);
			walk(child, o);
		}
	};
	walk(out, { x: 0, y: 0 });
	const all: ElkOutEdge[] = [];
	const collect = (n: ElkOutNode) => {
		all.push(...(n.edges ?? []));
		(n.children ?? []).forEach(collect);
	};
	collect(out);
	for (const e of all) {
		const section = e.sections?.[0];
		const target = edges.find((x) => x.id === e.id);
		if (!section || !target) continue;
		const o = offset.get(e.container ?? 'root') ?? { x: 0, y: 0 };
		const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map(
			(p) => ({ x: p.x + o.x, y: p.y + o.y })
		);
		target.data = { ...(target.data ?? {}), points };
	}
}

// ---------------------------------------------------------------------------
// A: step cards inside stage containers, edges leave from the fact row they hand over
// ---------------------------------------------------------------------------

async function buildCards(ix: ProcessIndex): Promise<Built> {
	const edges = handOffEdges(ix, true);
	const data = new Map<string, CardData>(ix.work.map((w) => [w.core.id, cardData(ix, w, false)]));
	const first = ix.stages[0]?.core.id;
	for (const [id, d] of data)
		if (
			!d.badge &&
			(ix.byId.get(id) as WorkItem).core.stage === first &&
			!edges.some((e) => e.target === id)
		)
			d.badge = 'Start';

	const ports = (id: string, d: CardData) => [
		{
			id: `${id}::in`,
			width: 1,
			height: 1,
			x: 0,
			y: CARD_HEAD / 2,
			layoutOptions: { 'elk.port.side': 'WEST' }
		},
		{
			id: `${id}::out`,
			width: 1,
			height: 1,
			x: CARD_W,
			y: CARD_HEAD / 2,
			layoutOptions: { 'elk.port.side': 'EAST' }
		},
		...d.rows.map((r, i) => ({
			id: `${id}::f:${r.id}`,
			width: 1,
			height: 1,
			x: CARD_W,
			y: rowPortY(i),
			layoutOptions: { 'elk.port.side': 'EAST' }
		}))
	];
	const stages = ix.stages.filter((s) => ix.work.some((w) => w.core.stage === s.core.id));
	const out = (await elk.layout({
		id: 'root',
		layoutOptions: {
			'elk.algorithm': 'layered',
			'elk.direction': 'RIGHT',
			'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
			'elk.edgeRouting': 'ORTHOGONAL',
			'elk.layered.spacing.nodeNodeBetweenLayers': '44',
			'elk.spacing.nodeNode': '28',
			'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
			'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES'
		},
		children: stages.map((st) => ({
			id: st.core.id,
			layoutOptions: { 'elk.padding': '[top=50,left=20,bottom=20,right=20]' },
			children: ix.work
				.filter((w) => w.core.stage === st.core.id)
				.map((w) => {
					const d = data.get(w.core.id)!;
					return {
						id: w.core.id,
						width: CARD_W,
						height: cardHeight(d),
						ports: ports(w.core.id, d),
						layoutOptions: { 'elk.portConstraints': 'FIXED_POS' }
					};
				})
		})),
		edges: [
			...edges.map((e) => ({
				id: e.id,
				sources: [`${e.source}::${e.sourceHandle}`],
				targets: [`${e.target}::in`]
			})),
			// invisible ordering edges keep stages left to right even when no fact links them
			...stages
				.slice(1)
				.map((st, i) => ({ id: `order:${i}`, sources: [stages[i].core.id], targets: [st.core.id] }))
		]
	})) as ElkOutNode;
	attachRoutes(out, edges);

	const nodes: Node[] = [];
	for (const st of out.children ?? []) {
		const index = stages.findIndex((s) => s.core.id === st.id);
		nodes.push({
			id: st.id,
			type: 'stage',
			position: { x: st.x ?? 0, y: st.y ?? 0 },
			data: { title: labelOf(ix, st.id), index: index + 1, count: st.children?.length ?? 0 },
			width: st.width,
			height: st.height,
			draggable: false,
			selectable: false,
			zIndex: -1
		});
		for (const child of st.children ?? []) {
			const d = data.get(child.id)!;
			nodes.push({
				id: child.id,
				type: 'card',
				parentId: st.id,
				position: { x: child.x ?? 0, y: child.y ?? 0 },
				data: d,
				width: CARD_W,
				height: cardHeight(d),
				draggable: false
			});
		}
	}
	return { nodes, edges };
}

// ---------------------------------------------------------------------------
// B: role lanes, left to right
// ---------------------------------------------------------------------------

export const LANE_LABEL_W = 172;
const LANE_COL_W = COMPACT_W + 72;
const LANE_ROW_H = COMPACT_H + 28;
const LANE_PAD = 22;

function buildLanes(ix: ProcessIndex): Built {
	const grid = laneGrid(ix);
	const width = LANE_LABEL_W + grid.cols * LANE_COL_W + 24;
	const nodes: Node[] = [];
	let y = 0;
	for (const lane of grid.lanes) {
		const height = lane.rows * LANE_ROW_H - 28 + LANE_PAD * 2;
		const role = ix.roles.find((r) => r.core.id === lane.role);
		nodes.push({
			id: `lane:${lane.role}`,
			type: 'lane',
			position: { x: 0, y },
			data: {
				title: labelOf(ix, lane.role),
				perCase: role?.core.scope === 'case',
				tone: roleTone(ix, lane.role),
				labelWidth: LANE_LABEL_W
			},
			width,
			height,
			draggable: false,
			selectable: false,
			zIndex: -1
		});
		for (const cell of lane.cells) {
			const item = ix.byId.get(cell.id) as WorkItem;
			nodes.push({
				id: cell.id,
				type: 'compact',
				parentId: `lane:${lane.role}`,
				position: {
					x: LANE_LABEL_W + cell.col * LANE_COL_W + 20,
					y: LANE_PAD + cell.row * LANE_ROW_H
				},
				data: { ...cardData(ix, item, true), hideRole: true },
				width: COMPACT_W,
				height: COMPACT_H,
				draggable: false
			});
		}
		y += height + 10;
	}
	const edges = handOffEdges(ix, false).map((e) => ({ ...e, data: { ...e.data, lane: true } }));
	return { nodes, edges };
}

// ---------------------------------------------------------------------------
// C: fact flow
// ---------------------------------------------------------------------------

async function buildFacts(ix: ProcessIndex): Promise<Built> {
	const flow = factFlow(ix);
	const collected = new Set<string>(ix.work.flatMap((w) => collectsOf(w).map((c) => c.fact)));
	const edges: Edge[] = flow.edges.map((e) => ({
		id: e.id,
		source: e.source,
		target: e.target,
		type: 'flow'
	}));
	const out = (await elk.layout({
		id: 'root',
		layoutOptions: {
			'elk.algorithm': 'layered',
			'elk.direction': 'RIGHT',
			'elk.edgeRouting': 'ORTHOGONAL',
			'elk.layered.spacing.nodeNodeBetweenLayers': '56',
			'elk.spacing.nodeNode': '16',
			'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES'
		},
		children: [
			...flow.work.map((id) => ({ id, width: COMPACT_W, height: COMPACT_H })),
			...flow.facts.map((f) => ({ id: `fact:${f}`, width: FACT_W, height: FACT_H }))
		],
		edges: edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] }))
	})) as ElkOutNode;
	attachRoutes(out, edges);
	const nodes: Node[] = (out.children ?? []).map((child) => {
		const position = { x: child.x ?? 0, y: child.y ?? 0 };
		if (child.id.startsWith('fact:')) {
			const id = child.id.slice(5);
			const fact = ix.byId.get(id) as FactNode | undefined;
			const data: FactData = {
				id,
				title: labelOf(ix, id),
				glyph: factType(fact?.core.schema).glyph,
				sensitive: fact?.core.schema['x-sensitivity'] === 'sensitive',
				missing: !collected.has(id)
			};
			return {
				id: child.id,
				type: 'fact',
				position,
				data,
				width: FACT_W,
				height: FACT_H,
				draggable: false
			};
		}
		const item = ix.byId.get(child.id) as WorkItem;
		return {
			id: child.id,
			type: 'compact',
			position,
			data: cardData(ix, item, true),
			width: COMPACT_W,
			height: COMPACT_H,
			draggable: false
		};
	});
	return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Workspace map: one card per definition, plus the fact types they share
// ---------------------------------------------------------------------------

export interface ProcessCardData extends Record<string, unknown> {
	slug: string;
	title: string;
	summary: string;
	steps: number;
	stages: number;
	roles: string[];
	dim?: boolean;
}

export async function buildMap(indexes: ProcessIndex[]): Promise<Built> {
	const documents: DefinitionDocument[] = indexes.map((ix) => ix.document);
	const shared = sharedFactTypes(documents);
	const links = processLinks(documents);
	const sharedHeight = 70 + shared.length * 20;
	const edges: Edge[] = links.map((l) => ({
		id: l.id,
		source: l.from,
		target: l.to,
		type: 'handoff',
		data: { facts: l.facts, alwaysLabel: true } satisfies HandOffData
	}));
	if (shared.length)
		for (const ix of indexes)
			if (shared.some((f) => f.uses.some((u) => u.slug === ix.document.slug && u.neededBy.length)))
				edges.push({
					id: `shared->${ix.document.slug}`,
					source: 'shared',
					target: ix.document.slug,
					type: 'handoff',
					data: { facts: [] }
				});
	const out = (await elk.layout({
		id: 'root',
		layoutOptions: {
			'elk.algorithm': 'layered',
			'elk.direction': 'RIGHT',
			'elk.edgeRouting': 'ORTHOGONAL',
			'elk.layered.spacing.nodeNodeBetweenLayers': '140',
			'elk.spacing.nodeNode': '48'
		},
		children: [
			...(shared.length ? [{ id: 'shared', width: SHARED_W, height: sharedHeight }] : []),
			...indexes.map((ix) => ({ id: ix.document.slug, width: PROCESS_W, height: PROCESS_H }))
		],
		edges: edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] }))
	})) as ElkOutNode;
	attachRoutes(out, edges);
	const nodes: Node[] = (out.children ?? []).map((child) => {
		const position = { x: child.x ?? 0, y: child.y ?? 0 };
		if (child.id === 'shared')
			return {
				id: 'shared',
				type: 'shared',
				position,
				data: { facts: shared.map((f) => f.title) },
				width: SHARED_W,
				height: sharedHeight,
				draggable: false
			};
		const ix = indexes.find((i) => i.document.slug === child.id)!;
		const data: ProcessCardData = {
			slug: ix.document.slug,
			title: labelOf(ix, ix.process?.core.id),
			summary: ix.process?.content ?? '',
			steps: ix.work.length,
			stages: ix.stages.length,
			roles: ix.roles
				.filter((r) => ix.work.some((w) => w.core.role === r.core.id))
				.map((r) => labelOf(ix, r.core.id))
		};
		return {
			id: child.id,
			type: 'process',
			position,
			data,
			width: PROCESS_W,
			height: PROCESS_H,
			draggable: false
		};
	});
	return { nodes, edges };
}

export function build(view: ViewId, ix: ProcessIndex): Promise<Built> {
	if (view === 'lanes') return Promise.resolve(buildLanes(ix));
	if (view === 'facts') return buildFacts(ix);
	return buildCards(ix);
}
