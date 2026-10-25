/**
 * The wizard's state for one spreadsheet import (ADR 0011), as plain JSON the store keeps with the
 * session. It moves through two phases: choosing the processes (the agent proposes a split, the
 * person renames, merges or splits it and accepts), then drafting each process (every agent turn
 * is a proposed edit the person accepts or rejects). Functions here are pure: they return a new
 * state and never touch the store.
 */
import type { Operation } from '@casebook/model';
import type { CellRange } from './sources.js';

/** A process the agent suggests making from part of the workbook. */
export interface ProposedProcess {
	key: string;
	title: string;
	/** One line on what the process covers. */
	summary: string;
	/** The cells it is drafted from. */
	sources: CellRange[];
	/** The title the agent suggested, when the person renamed it. */
	suggestedTitle?: string;
	/** Set when the person merged this process into another; it is then not created. */
	mergedInto?: string;
}

/** Cells every process may draw on, such as a sheet of documents several processes ask for. */
export interface SharedSource {
	title: string;
	summary: string;
	sources: CellRange[];
}

export interface SplitProposal {
	processes: ProposedProcess[];
	shared: SharedSource[];
}

/** A process the accepted split created. */
export interface WizardProcess {
	key: string;
	title: string;
	definitionId: string;
	slug: string;
	sources: CellRange[];
	/** True once one of the agent's drafts of it was accepted. */
	drafted: boolean;
}

export type TurnStatus = 'pending' | 'accepted' | 'rejected' | 'revised';

/**
 * One agent turn on a process: the node operations it proposes, applied together on accept. While
 * pending, it is shown against the draft as it is now; a reply in chat revises it into a new turn.
 */
export interface Turn {
	id: string;
	processKey: string;
	ops: Operation[];
	/** The agent's own summary of the turn. */
	summary: string;
	status: TurnStatus;
	/** What it changed, in plain language, recorded when it was accepted. */
	changes?: string[];
}

export type ChatCard =
	| { type: 'upload' }
	| { type: 'split' }
	| { type: 'turn'; turnId: string }
	| { type: 'publish'; processKey: string; ok: boolean; problems: string[]; version?: number };

export interface ChatEntry {
	id: string;
	/** `note` records what the person did outside the chat, such as accepting a turn. */
	role: 'user' | 'assistant' | 'note';
	text: string;
	card?: ChatCard;
}

export interface WizardState {
	phase: 'split' | 'draft';
	fileName: string;
	split?: SplitProposal;
	processes: WizardProcess[];
	/** The process being drafted. */
	activeKey?: string;
	messages: ChatEntry[];
	turns: Turn[];
	/** Increases with every id the state hands out, so ids are stable and readable. */
	counter: number;
}

export function startState(fileName: string): WizardState {
	return {
		phase: 'split',
		fileName,
		processes: [],
		messages: [
			{
				id: 'm1',
				role: 'assistant',
				text: `I am reading ${fileName} and will suggest how to split it into processes. Nothing is created until you accept the split, and nothing in a process changes until you accept a draft.`,
				card: { type: 'upload' }
			}
		],
		turns: [],
		counter: 1
	};
}

/** Hands out the next id with a prefix, such as `m7` or `t3`. */
export function nextId(state: WizardState, prefix: string): [WizardState, string] {
	const counter = state.counter + 1;
	return [{ ...state, counter }, `${prefix}${counter}`];
}

export function say(
	state: WizardState,
	role: ChatEntry['role'],
	text: string,
	card?: ChatCard
): WizardState {
	const [next, id] = nextId(state, 'm');
	return { ...next, messages: [...next.messages, { id, role, text, ...(card ? { card } : {}) }] };
}

/** Thrown for a request the wizard's state cannot take, with a plain-language reason. */
export class WizardError extends Error {
	override name = 'WizardError';
}

// The split

/** Records the agent's split proposal, replacing any earlier one. Keys stay stable by title. */
export function proposeSplit(
	state: WizardState,
	proposal: { processes: Omit<ProposedProcess, 'key'>[]; shared: SharedSource[] }
): WizardState {
	if (state.phase !== 'split') throw new WizardError('The split was already accepted');
	let next = state;
	const processes: ProposedProcess[] = [];
	for (const p of proposal.processes) {
		const [after, key] = nextId(next, 'p');
		next = after;
		processes.push({ ...p, key });
	}
	return { ...next, split: { processes, shared: proposal.shared } };
}

/** The proposed processes that accepting the split would create. */
export function liveProcesses(split: SplitProposal): ProposedProcess[] {
	return split.processes.filter((p) => p.mergedInto === undefined);
}

function proposed(state: WizardState, key: string): ProposedProcess {
	if (state.phase !== 'split' || !state.split) {
		throw new WizardError('There is no split to change; it was accepted already');
	}
	const found = state.split.processes.find((p) => p.key === key && p.mergedInto === undefined);
	if (!found) throw new WizardError(`There is no proposed process ${key}`);
	return found;
}

function replaceProposed(state: WizardState, changed: ProposedProcess[]): WizardState {
	const byKey = new Map(changed.map((p) => [p.key, p]));
	const split = state.split!;
	return {
		...state,
		split: { ...split, processes: split.processes.map((p) => byKey.get(p.key) ?? p) }
	};
}

export function renameProcess(state: WizardState, key: string, title: string): WizardState {
	const process = proposed(state, key);
	const trimmed = title.trim();
	if (!trimmed) throw new WizardError('A process needs a name');
	if (trimmed === process.title) return state;
	const renamed = {
		...process,
		title: trimmed,
		suggestedTitle: process.suggestedTitle ?? process.title
	};
	return say(
		replaceProposed(state, [renamed]),
		'note',
		`Renamed "${process.title}" to "${trimmed}".`
	);
}

/** Merges one proposed process into another: its cells are drafted as part of the other. */
export function mergeProcesses(state: WizardState, from: string, into: string): WizardState {
	if (from === into) throw new WizardError('A process cannot be merged into itself');
	const source = proposed(state, from);
	const target = proposed(state, into);
	const merged = { ...target, sources: [...target.sources, ...source.sources] };
	return say(
		replaceProposed(state, [merged, { ...source, mergedInto: into }]),
		'note',
		`Merged "${source.title}" into "${target.title}".`
	);
}

/**
 * Splits the cells at `sourceIndex` off a proposed process into a new one, right after it. Only a
 * process drafted from more than one range can be split this way; anything finer is asked for in
 * the chat.
 */
export function splitProcess(
	state: WizardState,
	key: string,
	sourceIndex: number,
	title?: string
): WizardState {
	const process = proposed(state, key);
	const moved = process.sources[sourceIndex];
	if (!moved || process.sources.length < 2) {
		throw new WizardError(
			`"${process.title}" is drafted from one range of cells; ask the assistant to split it differently`
		);
	}
	const [next, newKey] = nextId(state, 'p');
	const name = title?.trim() || `${process.title} (${moved.sheet})`;
	const rest = { ...process, sources: process.sources.filter((_, i) => i !== sourceIndex) };
	const added: ProposedProcess = {
		key: newKey,
		title: name,
		summary: `Split off "${process.title}"`,
		sources: [moved]
	};
	const split = next.split!;
	const processes = split.processes.flatMap((p) => (p.key === key ? [rest, added] : [p]));
	return say(
		{ ...next, split: { ...split, processes } },
		'note',
		`Split "${name}" off "${process.title}".`
	);
}

/** Moves to drafting once the accepted split's processes exist as definitions. */
export function splitAccepted(state: WizardState, created: WizardProcess[]): WizardState {
	if (created.length === 0) throw new WizardError('Accepting the split created no processes');
	return say(
		{ ...state, phase: 'draft', processes: created, activeKey: created[0]!.key },
		'note',
		`Split accepted: ${created.length} ${created.length === 1 ? 'process' : 'processes'}.`
	);
}

// Drafting

export function processOf(state: WizardState, key: string | undefined): WizardProcess {
	const found = state.processes.find((p) => p.key === key);
	if (!found) throw new WizardError(`There is no process ${key ?? '(none chosen)'} in this import`);
	return found;
}

/** The turn waiting for an answer on a process, if any. */
export function pendingTurn(state: WizardState, processKey: string): Turn | undefined {
	return state.turns.find((t) => t.processKey === processKey && t.status === 'pending');
}

/** Records the agent's proposed edit as the process's pending turn, revising any earlier one. */
export function proposeTurn(
	state: WizardState,
	processKey: string,
	ops: Operation[],
	summary: string
): WizardState {
	const [next, id] = nextId(state, 't');
	const turns = next.turns.map((t) =>
		t.processKey === processKey && t.status === 'pending' ? { ...t, status: 'revised' as const } : t
	);
	return say(
		{ ...next, turns: [...turns, { id, processKey, ops, summary, status: 'pending' }] },
		'assistant',
		summary,
		{ type: 'turn', turnId: id }
	);
}

export function settleTurn(
	state: WizardState,
	turnId: string,
	status: 'accepted' | 'rejected',
	changes?: string[]
): WizardState {
	const turn = state.turns.find((t) => t.id === turnId);
	if (!turn || turn.status !== 'pending') {
		throw new WizardError('That proposal is no longer waiting for an answer');
	}
	const turns = state.turns.map((t) =>
		t.id === turnId ? { ...t, status, ...(changes ? { changes } : {}) } : t
	);
	const processes =
		status === 'accepted'
			? state.processes.map((p) => (p.key === turn.processKey ? { ...p, drafted: true } : p))
			: state.processes;
	const title = processOf(state, turn.processKey).title;
	return say(
		{ ...state, turns, processes },
		'note',
		status === 'accepted'
			? `Accepted the changes to ${title}. They are saved to its draft.`
			: `Rejected the proposed changes to ${title}. Nothing was saved.`
	);
}

export function setActive(state: WizardState, key: string): WizardState {
	processOf(state, key);
	return { ...state, activeKey: key };
}
