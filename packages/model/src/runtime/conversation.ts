import type { Mark } from './progress.js';

/**
 * Events about a work item that never change its status (ADR 0025): a saved draft of its form,
 * and questions asking someone for missing information, with their replies.
 */
export const CONVERSATION_EVENTS = [
	'step.saved',
	'question.asked',
	'question.replied',
	'question.resolved'
] as const;

export type ConversationEventType = (typeof CONVERSATION_EVENTS)[number];

/** Work-item events that end or restart its form, which a saved draft does not outlive. */
const CLOSING = new Set([
	'step.completed',
	'step.skipped',
	'decision.made',
	'approval.granted',
	'approval.rejected'
]);

/** Work-item events that finish it, which also close the questions still open on it. */
const FINISHING = new Set(['step.completed', 'step.skipped', 'decision.made', 'approval.granted']);

/** One event of an item's log, as far as its conversation needs it. */
export interface ConversationEvent {
	/** The event's place in the case log, which names a question. */
	seq: number;
	type: string;
	item: string;
	by: string;
	at: string;
	data?: {
		values?: Record<string, string[]>;
		to?: string;
		text?: string;
		question?: number;
	};
}

/** The form's typed values as someone last saved them, before it was completed. */
export interface Draft extends Mark {
	values: Record<string, string[]>;
}

export interface Reply extends Mark {
	text: string;
}

/** A question about a work item, asked of one person, and what came back. */
export interface Question extends Mark {
	id: number;
	item: string;
	to: string;
	text: string;
	replies: Reply[];
	/** Someone other than the asker has replied. */
	answered: boolean;
	/** Someone closed it, or the item was finished, which closes its open questions. */
	resolved?: Mark;
}

export interface Conversation {
	/** The latest draft of each item's form since it was last completed, by item id. */
	drafts: Record<string, Draft>;
	/** Every question asked about the process's items, oldest first. */
	questions: Question[];
}

/** Folds one process's item events, oldest first, into its drafts and questions. */
export function foldConversation(events: readonly ConversationEvent[]): Conversation {
	const drafts: Record<string, Draft> = {};
	const questions = new Map<number, Question>();
	for (const event of events) {
		const mark = { by: event.by, at: event.at };
		if (CLOSING.has(event.type)) {
			delete drafts[event.item];
			if (FINISHING.has(event.type)) {
				for (const q of questions.values()) {
					if (q.item === event.item && !q.resolved) q.resolved = mark;
				}
			}
			continue;
		}
		switch (event.type) {
			case 'step.saved':
				drafts[event.item] = { ...mark, values: event.data?.values ?? {} };
				break;
			case 'question.asked':
				questions.set(event.seq, {
					...mark,
					id: event.seq,
					item: event.item,
					to: event.data?.to ?? '',
					text: event.data?.text ?? '',
					replies: [],
					answered: false
				});
				break;
			case 'question.replied': {
				const q = questions.get(event.data?.question ?? -1);
				if (!q) break;
				q.replies.push({ ...mark, text: event.data?.text ?? '' });
				if (event.by !== q.by) q.answered = true;
				break;
			}
			case 'question.resolved': {
				const q = questions.get(event.data?.question ?? -1);
				if (q && !q.resolved) q.resolved = mark;
				break;
			}
		}
	}
	return { drafts, questions: [...questions.values()] };
}

/** True when a question still waits on the person it was asked of. */
export function awaitingAnswer(q: Question): boolean {
	if (q.resolved) return false;
	const last = q.replies.at(-1);
	return !last || last.by !== q.to;
}
