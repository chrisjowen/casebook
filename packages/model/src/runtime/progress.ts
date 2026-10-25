import type { LifecycleEvent } from '../events.js';
import type { RunnableProcess } from './items.js';

/** Who did something to a work item, and when (an ISO 8601 timestamp). */
export interface Mark {
	by: string;
	at: string;
}

/** What has happened to one work item in one process on a case, folded from its events. */
export interface ItemProgress {
	/** The latest completion; for a repeating step, the latest repetition. */
	done?: Mark;
	/** How many times it was completed, which counts the repetitions of a repeating step. */
	count: number;
	/** Someone decided it does not apply, saying why. */
	skipped?: Mark & { reason: string };
	/** Paused because information is missing, with the note saying what. */
	held?: Mark & { note: string };
	/** People who started filling it in since it last opened, first first. */
	started: Mark[];
	/** Its approval sent it back, with the approver's note. */
	sentBack?: Mark & { note: string };
}

/** The work-item events the runtime records, a subset of the lifecycle names (ADR 0010). */
export const ITEM_EVENTS = [
	'step.started',
	'step.held',
	'step.resumed',
	'step.completed',
	'step.skipped',
	'decision.made',
	'approval.granted',
	'approval.rejected'
] as const satisfies readonly LifecycleEvent[];

export type ItemEventType = (typeof ITEM_EVENTS)[number];

/** One recorded event about a work item. `data` carries a hold note or a skip reason. */
export interface ItemEvent {
	type: ItemEventType;
	item: string;
	by: string;
	at: string;
	data?: { note?: string; reason?: string };
}

const fresh = (): ItemProgress => ({ count: 0, started: [] });

/**
 * Folds a process attachment's work-item events, oldest first, into the progress of each item.
 *
 * Completing an item clears its pause and who started it. A rejected approval reopens the step it
 * reviews, which then shows the approver's note, and the approval waits for the step again.
 */
export function foldProgress(
	process: RunnableProcess,
	events: readonly ItemEvent[]
): Record<string, ItemProgress> {
	const progress: Record<string, ItemProgress> = {};
	const of = (id: string) => (progress[id] ??= fresh());
	const reviews = new Map(process.items.map((i) => [i.id, i.reviews]));

	for (const event of events) {
		const p = of(event.item);
		const mark = { by: event.by, at: event.at };
		switch (event.type) {
			case 'step.started':
				if (!p.started.some((s) => s.by === event.by)) p.started.push(mark);
				break;
			case 'step.held':
				p.held = { ...mark, note: event.data?.note ?? '' };
				break;
			case 'step.resumed':
				delete p.held;
				break;
			case 'step.skipped':
				p.skipped = { ...mark, reason: event.data?.reason ?? '' };
				delete p.held;
				break;
			case 'step.completed':
			case 'decision.made':
			case 'approval.granted':
				p.done = mark;
				p.count += 1;
				p.started = [];
				delete p.held;
				delete p.sentBack;
				break;
			case 'approval.rejected': {
				p.started = [];
				const step = reviews.get(event.item);
				if (step) {
					const reviewed = of(step);
					delete reviewed.done;
					reviewed.started = [];
					reviewed.sentBack = { ...mark, note: event.data?.note ?? '' };
				}
				break;
			}
		}
	}
	return progress;
}
