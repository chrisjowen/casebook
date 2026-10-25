/**
 * The board: one column per stage, left to right in stage order, including empty stages. Inside a
 * column, an item that waits for another item in the same stage moves one sub-column right and
 * parallel items stack. Nothing is stored about positions, so a process built by hand, imported
 * or written by the wizard agent always lands in the same tidy places.
 *
 * Links are hand-offs (ADR 0003). Each runs down the gap after its source or before its target,
 * or over the top of the board when a card is in the way, so a line never passes behind a card.
 */
import type { Edge, Node } from '@xyflow/svelte';
import type { FactNode } from '@casebook/model';
import { branchOf } from '$lib/editor/ops';
import {
	collectorsByFact,
	collectsOf,
	factType,
	handOffs,
	humanizeDuration,
	labelOf,
	reduceTransitive,
	requiresOf,
	type FactGlyph,
	type HandOff,
	type ProcessIndex,
	type WorkItem
} from './derive';
import { roleTone } from './layout';

export const BOARD_CARD_W = 256;
export const BOARD_HEAD = 58;
export const BOARD_ROW = 26;
const ROWS_PAD = 5;
const MAX_ROWS = 5;
const CHIPS = 30;
const COL_PAD = 18;
const COL_HEAD = 52;
const GAP_Y = 18;
const SUB_GAP = 64;
const COL_GAP = 28;
const ADD_H = 44;
const MIN_H = 280;
export const GHOST_ID = '__add-stage';

/** A row on a card: a fact it records, or one of a decision's choices. */
export interface BoardRow {
	/** Handle id: `f:<fact>` for a recorded fact, `b:<choice>` for a decision's choice. */
	handle: string;
	title: string;
	type: string;
	glyph: FactGlyph | 'branch';
	fact: string;
}

export interface BoardCardData extends Record<string, unknown> {
	id: string;
	kind: 'step' | 'decision';
	title: string;
	role: string;
	roleTone: number;
	actor: string;
	stage: string;
	rows: BoardRow[];
	more: number;
	/** Every fact it needs, for highlighting where a fact is used. */
	requires: string[];
	/** Names of facts it needs that nothing records. */
	missing: string[];
	guard?: string;
	repeat?: string;
	approval?: string;
	/** Nothing comes after it yet, so its "+" stays faintly visible as the place to continue. */
	leaf: boolean;
	dim?: boolean;
	/** How a proposal under review changes it, such as the wizard agent's. */
	mark?: 'new' | 'changed';
}

export interface BoardStageData extends Record<string, unknown> {
	id: string;
	title: string;
	index: number;
	count: number;
}

/** How a link is drawn: down the gap after the source, before the target, or over the top. */
export interface BoardRoute {
	mode: 'after' | 'before' | 'top';
	x1: number;
	x2: number;
	top: number;
}

export interface BoardEdgeData extends Record<string, unknown> {
	handoff: HandOff;
	facts: string[];
	/** The decision choice the target runs for, when it is a branch. */
	branch?: string;
	route?: BoardRoute;
}

export interface Column {
	id: string;
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface BoardBuilt {
	nodes: Node[];
	/** Hand-offs with transitive ones dropped, so hubs do not fan out everywhere. */
	edges: Edge[];
	/** Every hand-off; a selected card shows all of its own. */
	all: Edge[];
	columns: Column[];
}

const ACTOR = { human: 'Person', agent: 'Agent', either: 'Person or agent' } as const;

export function boardRows(ix: ProcessIndex, item: WorkItem): BoardRow[] {
	const core = item.core;
	if (core.kind === 'decision') {
		const outcome = ix.byId.get(core.outcome) as FactNode | undefined;
		const choices = Array.isArray(outcome?.core.schema.enum) ? outcome.core.schema.enum : [];
		if (choices.length)
			return choices.map((c) => ({
				handle: `b:${String(c)}`,
				title: String(c),
				type: 'Choice',
				glyph: 'branch' as const,
				fact: core.outcome
			}));
	}
	return collectsOf(item).map(({ fact }) => {
		const t = factType((ix.byId.get(fact) as FactNode | undefined)?.core.schema);
		return { handle: `f:${fact}`, title: labelOf(ix, fact), type: t.label, glyph: t.glyph, fact };
	});
}

export function boardCardData(ix: ProcessIndex, item: WorkItem, leaf = false): BoardCardData {
	const rows = boardRows(ix, item);
	const collectors = collectorsByFact(ix);
	const requires = requiresOf(item);
	const step = item.core.kind === 'step' ? item.core : undefined;
	return {
		id: item.core.id,
		kind: item.core.kind,
		title: labelOf(ix, item.core.id),
		role: labelOf(ix, item.core.role),
		roleTone: roleTone(ix, item.core.role),
		actor: ACTOR[item.core.actor],
		stage: item.core.stage,
		rows: rows.slice(0, MAX_ROWS),
		more: Math.max(0, rows.length - MAX_ROWS),
		requires,
		missing: requires.filter((f) => !collectors.has(f)).map((f) => labelOf(ix, f)),
		guard: item.core.when?.text,
		repeat: step?.repeat
			? step.repeat.every
				? `Every ${humanizeDuration(step.repeat.every)}`
				: 'Repeats'
			: undefined,
		approval: step?.approval ? labelOf(ix, step.approval) : undefined,
		leaf
	};
}

/** Row centre, measured from the card top, for the handle of row `i`. */
export const boardRowY = (i: number) => BOARD_HEAD + ROWS_PAD + i * BOARD_ROW + BOARD_ROW / 2;

export function boardCardHeight(d: BoardCardData): number {
	const rows = d.rows.length + (d.more ? 1 : 0) + 1; // and the "Add fact" row
	const chips = d.guard || d.repeat || d.approval || d.missing.length ? CHIPS : 0;
	return BOARD_HEAD + ROWS_PAD * 2 + rows * BOARD_ROW + chips + 12;
}

/** The handle a hand-off leaves from: the choice or fact row it carries, else the card. */
function sourceHandle(ix: ProcessIndex, h: HandOff, rows: BoardRow[]): string {
	const from = ix.byId.get(h.from) as WorkItem;
	const to = ix.byId.get(h.to) as WorkItem;
	if (from.core.kind === 'decision') {
		const choice = branchOf(to, from.core.outcome);
		return choice && rows.some((r) => r.handle === `b:${choice}`) ? `b:${choice}` : 'out';
	}
	const row = rows.find((r) => h.facts.includes(r.fact as never));
	return row ? row.handle : 'out';
}

function edgesFor(ix: ProcessIndex, list: HandOff[], data: Map<string, BoardCardData>): Edge[] {
	return list.map((h) => {
		const from = ix.byId.get(h.from) as WorkItem;
		const to = ix.byId.get(h.to) as WorkItem;
		const branch = from.core.kind === 'decision' ? branchOf(to, from.core.outcome) : undefined;
		return {
			id: h.id,
			source: h.from,
			target: h.to,
			sourceHandle: sourceHandle(ix, h, data.get(h.from)?.rows ?? []),
			targetHandle: 'in',
			type: 'board',
			zIndex: 1,
			data: {
				handoff: h,
				facts: h.facts.map((f) => labelOf(ix, f)),
				...(branch ? { branch } : {})
			} satisfies BoardEdgeData
		};
	});
}

type Box = { x: number; y: number; w: number; h: number };

/** Picks a route for each link through the gaps between cards, or over the top when blocked. */
function route(edges: Edge[], boxes: Map<string, Box>, data: Map<string, BoardCardData>) {
	let lane = 0;
	for (const e of edges) {
		const s = boxes.get(e.source);
		const t = boxes.get(e.target);
		if (!s || !t) continue;
		const rows = data.get(e.source)?.rows ?? [];
		const i = rows.findIndex((r) => r.handle === e.sourceHandle);
		const sy = s.y + (i >= 0 ? boardRowY(i) : BOARD_HEAD / 2);
		const ty = t.y + BOARD_HEAD / 2;
		const x1 = s.x + s.w + 22;
		const x2 = t.x - 22;
		const blocked = (y: number) =>
			[...boxes.entries()].some(
				([id, b]) =>
					id !== e.source &&
					id !== e.target &&
					y > b.y - 6 &&
					y < b.y + b.h + 6 &&
					b.x < Math.max(x1, x2) &&
					b.x + b.w > Math.min(x1, x2)
			);
		let mode: BoardRoute['mode'] = 'top';
		if (x2 >= x1 && !blocked(ty)) mode = 'after';
		else if (x2 >= x1 && !blocked(sy)) mode = 'before';
		e.data = { ...e.data, route: { mode, x1, x2, top: -22 - 9 * (mode === 'top' ? lane++ : 0) } };
	}
}

export function buildBoard(ix: ProcessIndex): BoardBuilt {
	const all = handOffs(ix);
	const stageOf = new Map<string, string>(ix.work.map((w) => [w.core.id, w.core.stage]));
	const preds = new Map<string, string[]>();
	for (const e of all)
		if (stageOf.get(e.from) === stageOf.get(e.to))
			preds.set(e.to, [...(preds.get(e.to) ?? []), e.from]);
	const rank = new Map<string, number>();
	const visit = (id: string, trail: Set<string>): number => {
		const known = rank.get(id);
		if (known !== undefined) return known;
		if (trail.has(id)) return 0; // a cycle: the publish checks report it
		trail.add(id);
		const r = Math.max(-1, ...(preds.get(id) ?? []).map((p) => visit(p, trail))) + 1;
		trail.delete(id);
		rank.set(id, r);
		return r;
	};
	for (const w of ix.work) visit(w.core.id, new Set());

	const sources = new Set(all.map((e) => e.from));
	const data = new Map<string, BoardCardData>(
		ix.work.map((w) => [w.core.id, boardCardData(ix, w, !sources.has(w.core.id))])
	);
	const columns: Column[] = [];
	const placed: { col: Column; items: { id: string; sub: number; y: number }[] }[] = [];
	let x = 0;
	let tallest = MIN_H;
	for (const stage of ix.stages) {
		const items = ix.work.filter((w) => w.core.stage === stage.core.id);
		const subs = Math.max(1, ...items.map((w) => (rank.get(w.core.id) ?? 0) + 1));
		const w = subs * BOARD_CARD_W + (subs - 1) * SUB_GAP + COL_PAD * 2;
		const heights = Array.from({ length: subs }, () => COL_HEAD + 8);
		const positions = items.map((item) => {
			const sub = rank.get(item.core.id) ?? 0;
			const y = heights[sub];
			heights[sub] += boardCardHeight(data.get(item.core.id)!) + GAP_Y;
			return { id: item.core.id, sub, y };
		});
		tallest = Math.max(tallest, Math.max(...heights) + ADD_H + 8);
		const col = { id: stage.core.id, x, y: 0, w, h: 0 };
		columns.push(col);
		placed.push({ col, items: positions });
		x += w + COL_GAP;
	}
	const cards: Node[] = [];
	for (const { col, items } of placed) {
		col.h = tallest;
		for (const p of items) {
			const d = data.get(p.id)!;
			cards.push({
				id: p.id,
				type: 'card',
				position: { x: col.x + COL_PAD + p.sub * (BOARD_CARD_W + SUB_GAP), y: p.y },
				width: BOARD_CARD_W,
				height: boardCardHeight(d),
				data: d,
				zIndex: 2
			});
		}
	}
	const stages: Node[] = columns.map((c, i) => ({
		id: c.id,
		type: 'stage',
		position: { x: c.x, y: c.y },
		width: c.w,
		height: c.h,
		draggable: false,
		selectable: false,
		zIndex: 0,
		data: {
			id: c.id,
			title: labelOf(ix, c.id),
			index: i + 1,
			count: ix.work.filter((w) => w.core.stage === c.id).length
		} satisfies BoardStageData
	}));
	const ghost: Node = {
		id: GHOST_ID,
		type: 'addStage',
		position: { x, y: 0 },
		width: 200,
		height: tallest,
		draggable: false,
		selectable: false,
		zIndex: 0,
		data: {}
	};
	const boxes = new Map<string, Box>(
		cards.map((c) => [c.id, { x: c.position.x, y: c.position.y, w: c.width!, h: c.height! }])
	);
	const reduced = edgesFor(ix, reduceTransitive(all), data);
	const every = edgesFor(ix, all, data);
	route(reduced, boxes, data);
	route(every, boxes, data);
	return { nodes: [...stages, ghost, ...cards], edges: reduced, all: every, columns };
}

/** The stage column under a point on the board, with some slack above and below. */
export function columnAt(columns: Column[], p: { x: number; y: number }): Column | undefined {
	return columns.find(
		(c) => p.x >= c.x && p.x <= c.x + c.w && p.y >= c.y - 40 && p.y <= c.y + c.h + 40
	);
}
