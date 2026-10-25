/**
 * The wizard's steps (ADR 0011), each taking the import's state and returning the next one:
 * 1. `start` reads the workbook, then `proposeSplit` asks the agent how to split it;
 * 2. the person renames, merges or splits processes (pure functions in `state.ts`), or replies
 *    in chat so the agent proposes again, and `acceptSplit` creates the processes;
 * 3. `draft` and `reply` run agent turns, each recorded as a proposal on the process being drafted;
 * 4. `acceptTurn` saves a proposal as one edit of the draft, `rejectTurn` drops it.
 * Publishing is the editor's own publish, which runs the publish checks (ADR 0005).
 */
import { runAgent, type AgentContext } from './agent.js';
import { sheetOverview } from './context.js';

export { sheetOverview };
import type { DraftAccess } from './drafts.js';
import { formatRange, sourceRef } from './sources.js';
import {
	liveProcesses,
	pendingTurn,
	processOf,
	proposeSplit as recordSplit,
	proposeTurn,
	say,
	setActive,
	settleTurn,
	splitAccepted,
	startState,
	WizardError,
	type WizardProcess,
	type WizardState
} from './state.js';

export { startState as start };

/** Asks the agent for its first split proposal. */
export function proposeSplit(ctx: AgentContext, state: WizardState): Promise<WizardState> {
	const request = `Read the workbook and propose how to split it into processes. Its sheets:\n${sheetOverview(ctx.workbook)}`;
	return ask(ctx, state, request, undefined, true);
}

/** The person's message in chat: the agent answers in the current phase. */
export function reply(ctx: AgentContext, state: WizardState, text: string): Promise<WizardState> {
	const message = text.trim();
	if (!message) throw new WizardError('Write a message first');
	return ask(ctx, state, message, message, state.phase === 'draft' ? 'maybe' : false);
}

/** Asks the agent to draft a process of the accepted split, making it the one being drafted. */
export function draft(ctx: AgentContext, state: WizardState, key: string): Promise<WizardState> {
	const process = processOf(state, key);
	const shown = process.drafted
		? `Continue drafting ${process.title}.`
		: `Draft ${process.title} from its cells.`;
	const cells = process.sources.map(formatRange).join(', ');
	const request = `${shown} Its cells are ${cells}. Call read_draft, then call apply_operations three times: its stages and roles, then its facts, then its steps.`;
	return ask(ctx, setActive(state, key), request, shown, true);
}

/**
 * Runs the agent on `request` and records the outcome, after `shown` as the person's message
 * when there is one. The agent sees the conversation before it, then `request`.
 */
async function ask(
	ctx: AgentContext,
	state: WizardState,
	request: string,
	shown?: string,
	/** The request asks for a proposal, or may (`'maybe'`), so a turn without one is nudged. */
	expectProposal: boolean | 'maybe' = false
): Promise<WizardState> {
	const outcome = await runAgent(ctx, state, request, { expectProposal });
	const asked = shown === undefined ? state : say(state, 'user', shown);
	if (outcome.phase === 'split') {
		return outcome.split
			? say(recordSplit(asked, outcome.split), 'assistant', outcome.reply, { type: 'split' })
			: say(asked, 'assistant', outcome.reply);
	}
	if (outcome.ops.length > 0 && (outcome.changed || !pendingTurn(asked, outcome.processKey))) {
		return proposeTurn(asked, outcome.processKey, outcome.ops, outcome.reply);
	}
	return say(asked, 'assistant', outcome.reply);
}

/**
 * Creates one governed process per process of the split, each holding only its process node with
 * a link to its cells, then moves to drafting the first.
 */
export async function acceptSplit(
	drafts: DraftAccess,
	state: WizardState,
	namespaceId: string
): Promise<WizardState> {
	if (state.phase !== 'split' || !state.split) {
		throw new WizardError('There is no split to accept yet');
	}
	const created: WizardProcess[] = [];
	for (const p of liveProcesses(state.split)) {
		const result = await drafts.create({
			namespaceId,
			title: p.title,
			source: sourceRef(state.fileName, p.sources)
		});
		if (!result.ok) {
			if (created.length === 0) throw new WizardError(result.reason);
			// Some were made: keep them, and say which could not be.
			return say(
				splitAccepted(state, created),
				'note',
				`Could not create "${p.title}": ${result.reason}`
			);
		}
		created.push({
			key: p.key,
			title: p.title,
			definitionId: result.definitionId,
			slug: result.slug,
			sources: p.sources,
			drafted: false
		});
	}
	return splitAccepted(state, created);
}

/**
 * Saves a pending proposal as one edit of its process's draft, made against `baseRevision`, the
 * revision the person reviewed it on. The store checks the edit as the signed-in person.
 */
export async function acceptTurn(
	drafts: DraftAccess,
	state: WizardState,
	turnId: string,
	baseRevision: number
): Promise<WizardState> {
	const turn = state.turns.find((t) => t.id === turnId);
	if (!turn || turn.status !== 'pending') {
		throw new WizardError('That proposal is no longer waiting for an answer');
	}
	const process = processOf(state, turn.processKey);
	const preview = await drafts.preview(process.definitionId, baseRevision, turn.ops);
	if (!preview.ok) throw new WizardError(preview.reason);
	const saved = await drafts.edit(process.definitionId, baseRevision, turn.ops);
	if (!saved.ok) throw new WizardError(saved.reason);
	return settleTurn(
		state,
		turnId,
		'accepted',
		preview.changes.map((c) => c.summary)
	);
}

export function rejectTurn(state: WizardState, turnId: string): WizardState {
	return settleTurn(state, turnId, 'rejected');
}

/** Records a publish attempt in the chat, with the checks that blocked it. */
export function recordPublish(
	state: WizardState,
	processKey: string,
	result: { ok: true; version: number } | { ok: false; reason: string; problems: string[] }
): WizardState {
	const title = processOf(state, processKey).title;
	return result.ok
		? say(state, 'note', `Published ${title} as version ${result.version}.`, {
				type: 'publish',
				processKey,
				ok: true,
				problems: [],
				version: result.version
			})
		: say(state, 'note', `${title} was not published: ${result.reason}`, {
				type: 'publish',
				processKey,
				ok: false,
				problems: result.problems
			});
}
