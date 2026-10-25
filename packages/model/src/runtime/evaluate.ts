import { guardReferences } from '../guard.js';
import type { FactId, Guard } from '../node.js';
import {
	evaluateGuard,
	GuardSyntaxError,
	type GuardFacts,
	type GuardOptions,
	type GuardValue
} from './expression.js';
import type { RunnableProcess, StageInfo, WorkItem } from './items.js';
import type { ItemProgress } from './progress.js';

/**
 * Where a work item stands for the people on a case:
 *
 * - `done` and `skipped` are settled; a guard that rules an item out skips it without anyone.
 * - `ready`: its stage is reached and everything it needs is recorded, so its role can do it now.
 * - `held`: someone paused it because information is missing.
 * - `waiting`: it needs a fact that another unfinished item records.
 * - `blocked`: it needs a fact that nothing left in the process records.
 * - `upcoming`: its stage is not reached yet, or it reviews a step that is not done yet.
 */
export const ITEM_STATUSES = [
	'done',
	'skipped',
	'ready',
	'held',
	'waiting',
	'blocked',
	'upcoming'
] as const;

export type ItemStatus = (typeof ITEM_STATUSES)[number];

/**
 * How an item's `when` guard reads on the case (ADR 0004):
 * `none` without a guard; `applies` or `does-not-apply` when its expression decides;
 * `pending` while the expression needs facts nobody has recorded; `open` for a guard in prose
 * only, or one whose expression cannot be evaluated, which the item's role decides by doing the
 * work or skipping it.
 */
export type GuardState = 'none' | 'applies' | 'does-not-apply' | 'pending' | 'open';

export interface ItemState {
	item: WorkItem;
	status: ItemStatus;
	/** Index of the item's stage in the process. */
	stageIndex: number;
	progress: ItemProgress;
	guard: GuardState;
	/** Facts it needs that are not recorded yet, including any its guard is waiting for. */
	missing: FactId[];
	/** For `waiting`: the unfinished item that records a missing fact. */
	waitingOn?: string;
	/** For a repeating step that is still repeating: when the next repetition is due. */
	due?: string;
	overdue?: boolean;
}

export interface StageState extends StageInfo {
	state: 'done' | 'current' | 'upcoming';
}

export interface ProcessState {
	stages: StageState[];
	/** Index of the current stage; equals the number of stages once the process is complete. */
	current: number;
	complete: boolean;
	items: ItemState[];
}

const OPEN: ReadonlySet<ItemStatus> = new Set(['ready', 'held', 'waiting', 'blocked']);

/** True for an item someone still has to do or unblock: ready, held, waiting or blocked. */
export const isOpen = (status: ItemStatus) => OPEN.has(status);

function readGuard(guard: Guard | undefined, facts: GuardFacts, options: GuardOptions): GuardState {
	if (guard === undefined) return 'none';
	if (guard.expr === undefined) return 'open';
	let value: GuardValue;
	try {
		value = evaluateGuard(guard.expr, facts, options);
	} catch (error) {
		if (error instanceof GuardSyntaxError) return 'open';
		throw error;
	}
	return value === undefined ? 'pending' : value ? 'applies' : 'does-not-apply';
}

/**
 * Works out where a process attached to a case stands: the state of every work item, and from
 * that the current stage.
 *
 * Settled items come first: completed and skipped items, items whose guard rules them out, and
 * approvals of skipped steps. The current stage is the first one with an unsettled item. A
 * repeating step never holds its stage open, and is settled once its `until` condition holds.
 * Unsettled items in the current or an earlier stage are then ready, held, waiting or blocked;
 * later ones are upcoming.
 *
 * @param facts the case's recorded facts: the current value of each, by fact id.
 * @param progress each item's progress, from `foldProgress`.
 * @param timeZone the IANA time zone its conditions count calendar days in.
 */
export function evaluateProcess(
	process: RunnableProcess,
	facts: GuardFacts,
	progress: Readonly<Record<string, ItemProgress>>,
	now: Date,
	timeZone = 'UTC'
): ProcessState {
	const stageIndex = new Map(process.stages.map((s, i) => [s.id, i]));
	const progressOf = (id: string): ItemProgress => progress[id] ?? { count: 0, started: [] };
	const recorded = (fact: string) => Object.hasOwn(facts, fact);

	const settled = new Map<string, 'done' | 'skipped'>();
	const guards = new Map<string, GuardState>();
	for (const item of process.items) {
		const p = progressOf(item.id);
		const guard = readGuard(item.when, facts, { now, timeZone });
		guards.set(item.id, guard);
		if (p.skipped) settled.set(item.id, 'skipped');
		else if (item.repeat) {
			if (readGuard(item.repeat.until, facts, { now, timeZone }) === 'applies')
				settled.set(item.id, 'done');
		} else if (p.done) settled.set(item.id, 'done');
		else if (guard === 'does-not-apply') settled.set(item.id, 'skipped');
		else if (item.reviews && settled.get(item.reviews) === 'skipped') {
			settled.set(item.id, 'skipped');
		}
	}

	let current = process.stages.length;
	for (const [index, stage] of process.stages.entries()) {
		const open = process.items.some((i) => i.stage === stage.id && !i.repeat && !settled.has(i.id));
		if (open) {
			current = index;
			break;
		}
	}

	const items = process.items.map((item): ItemState => {
		const p = progressOf(item.id);
		const guard = guards.get(item.id)!;
		const index = stageIndex.get(item.stage) ?? process.stages.length;
		const base = { item, stageIndex: index, progress: p, guard, missing: [] as FactId[] };
		const state = settled.get(item.id);
		if (state) return { ...base, status: state };
		if (index > current) return { ...base, status: 'upcoming' };
		if (item.reviews && settled.get(item.reviews) !== 'done') {
			return { ...base, status: 'upcoming' };
		}

		const missing = new Set(item.requires.filter((f) => !recorded(f)));
		if (guard === 'pending' && item.when?.expr) {
			for (const f of guardReferences(item.when.expr).facts)
				if (!recorded(f)) missing.add(f as FactId);
		}
		const repeat = item.repeat ? dueOf(item, p, now) : {};
		if (p.held) return { ...base, ...repeat, missing: [...missing], status: 'held' };
		if (missing.size > 0) {
			const provider = process.items.find(
				(other) =>
					other.id !== item.id &&
					!settled.has(other.id) &&
					other.collects.some((c) => missing.has(c.fact))
			);
			return {
				...base,
				...repeat,
				missing: [...missing],
				status: provider ? 'waiting' : 'blocked',
				...(provider ? { waitingOn: provider.id } : {})
			};
		}
		return { ...base, ...repeat, status: 'ready' };
	});

	return {
		stages: process.stages.map((s, i) => ({
			...s,
			state: i < current ? 'done' : i === current ? 'current' : 'upcoming'
		})),
		current,
		complete: current >= process.stages.length,
		items
	};
}

function dueOf(item: WorkItem, p: ItemProgress, now: Date): { due: string; overdue: boolean } {
	const every = item.repeat?.every ? durationMs(item.repeat.every) : undefined;
	const due = p.done && every !== undefined ? new Date(new Date(p.done.at).getTime() + every) : now;
	return { due: due.toISOString(), overdue: due.getTime() <= now.getTime() };
}

const DURATION =
	/^P(?:(\d+(?:\.\d+)?)Y)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

/**
 * An ISO 8601 duration such as `PT30M` in milliseconds, or undefined when it does not parse.
 * Years and months count as 365 and 30 days.
 */
export function durationMs(duration: string): number | undefined {
	const m = DURATION.exec(duration);
	if (!m || duration === 'P' || duration.endsWith('T')) return undefined;
	const [y, mo, w, d, h, mi, s] = m.slice(1).map((v) => (v === undefined ? 0 : Number(v)));
	const day = 86_400_000;
	return (
		y! * 365 * day +
		mo! * 30 * day +
		w! * 7 * day +
		d! * day +
		h! * 3_600_000 +
		mi! * 60_000 +
		s! * 1000
	);
}
