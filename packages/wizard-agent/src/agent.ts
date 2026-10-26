/**
 * The authoring agent: a deepagents agent (ADR 0012) shown the workbook and four tools of its own.
 * In either phase it may read cells of the workbook; in the split phase it may otherwise only
 * propose a split; in the draft phase it may only read the process being drafted and apply node
 * operations to it, each checked by the store's definition service as an edit by the signed-in
 * person and collected into one proposal the person accepts or rejects (ADR 0011). Nothing it does
 * is saved by the agent itself. The model's output is followed as it streams (ADR 0029), so the
 * person sees its words and what it proposes while it writes them.
 */
import {
	BaseCallbackHandler,
	type HandleLLMNewTokenCallbackFields,
	type NewTokenIndices
} from '@langchain/core/callbacks/base';
import {
	AIMessage,
	AIMessageChunk,
	HumanMessage,
	SystemMessage,
	ToolMessage,
	type BaseMessage
} from '@langchain/core/messages';
import type { BaseLanguageModel } from '@langchain/core/language_models/base';
import { parsePartialJson } from '@langchain/core/output_parsers';
import { tool, type StructuredToolInterface } from '@langchain/core/tools';
import { createDeepAgent } from 'deepagents';
import { createMiddleware } from 'langchain';
import { z } from 'zod';
import {
	checkOperation,
	OPERATION_SCHEMAS,
	type DefinitionDocument,
	type Node,
	type Operation
} from '@casebook/model';
import type { Workbook } from '@casebook/sheet-import';
import { rangesText, workbookOpening } from './context.js';
import type { DraftAccess } from './drafts.js';
import { SYSTEM_PROMPT } from './prompt.js';
import {
	completeSource,
	describeRange,
	formatRange,
	plainRange,
	rangeProblem,
	sourceProblem,
	type CellRange
} from './sources.js';
import {
	pendingTurn,
	processOf,
	type SharedSource,
	type ProposedProcess,
	type WizardState
} from './state.js';

export interface AgentContext {
	/** A tool-calling chat model, such as `createChatModel()`. */
	model: BaseLanguageModel;
	/** Definitions as the signed-in person reaches them. */
	drafts: DraftAccess;
	workbook: Workbook;
	/** Stops the run, such as when it takes too long. */
	signal?: AbortSignal;
	/** Told what the agent is doing as it goes, such as `Reading the Claims sheet`. */
	onProgress?: (activity: string) => void;
	/** Told what the agent has written so far in the turn, as it writes it. */
	onLive?: (live: LiveTurn) => void;
	/**
	 * Whether operations a model writes into its reply are read, and operations written slightly
	 * wrong are tidied before they are checked, for small local models. Otherwise operations are
	 * taken only from `apply_operations`, checked as sent.
	 */
	lenient?: boolean;
}

/** What one run of the agent produced. */
export type AgentOutcome =
	| {
			phase: 'split';
			reply: string;
			split?: { processes: Omit<ProposedProcess, 'key'>[]; shared: SharedSource[] };
	  }
	| {
			phase: 'draft';
			reply: string;
			processKey: string;
			/** Every operation of the proposal, carried-over ones first; empty when it proposed none. */
			ops: Operation[];
			/** Whether the operations differ from the pending proposal it started from. */
			changed: boolean;
	  };

/** One thing the agent is proposing, as the person sees it while the turn runs. */
export interface LiveItem {
	/** `process` or `shared` while splitting; a node kind, or `change`, while drafting. */
	kind: string;
	title: string;
}

/** What the agent has written so far in a turn. */
export interface LiveTurn {
	/** Its words to the person, from the latest model call that wrote any. */
	text: string;
	/** What it is proposing: the processes of the split, or this turn's nodes and changes. */
	items: LiveItem[];
}

/** Bound on the cells one read_cells call returns. */
const READ_CHARS = 16_000;
/** Bound on agent steps in one turn, so a confused agent cannot loop for long. */
const RECURSION_LIMIT = 40;
/** Refused tool calls in a row after which the agent is told to stop and explain. */
const MAX_REFUSALS = 3;
/** Rounds in one turn of reading operations a model wrote into its reply. */
const MAX_ROUNDS = 4;

const SPLIT_NUDGE =
	'You described processes but did not call propose_split, so nothing was recorded. Call propose_split now with that split, then reply briefly.';
const DRAFT_NUDGE =
	'You did not call apply_operations, so nothing was proposed. Call apply_operations now with the operations for what you described, then reply briefly.';
const REPLY_NUDGE =
	'You did not call apply_operations, so the draft is unchanged. If you meant to change it, call apply_operations now with the operations; if you only answered a question, repeat your answer briefly.';

/**
 * Runs the agent once on the import's current phase, with `request` as the person's message. With
 * `expectProposal`, a turn that ends without proposing anything, as small models' turns sometimes
 * do when they describe a proposal in prose, is asked once more to make the call; with `'maybe'`
 * (a reply in chat while drafting), it is asked to make it only if it meant to change the draft.
 */
export async function runAgent(
	ctx: AgentContext,
	state: WizardState,
	request: string,
	{ expectProposal = false }: { expectProposal?: boolean | 'maybe' } = {}
): Promise<AgentOutcome> {
	if (state.phase === 'split') {
		const collected: { split?: Extract<AgentOutcome, { phase: 'split' }>['split'] } = {};
		const tools = [readCellsTool(ctx), splitTool(ctx, state, collected)];
		const watch = new TurnWatch(ctx, 'Reading the spreadsheet', () =>
			collected.split ? splitItems(collected.split) : []
		);
		let reply = await invoke(ctx, state, request, tools, watch);
		if (expectProposal === true && !collected.split) {
			reply = await invoke(ctx, state, request, tools, watch, [[reply, SPLIT_NUDGE]]);
		}
		return { phase: 'split', reply, ...(collected.split ? { split: collected.split } : {}) };
	}
	const process = processOf(state, state.activeKey);
	const session = await draftSession(ctx, state, process.key);
	const preface = session.dropped
		? `(Your earlier proposal no longer fits the draft, which changed since: ${session.dropped}. Start again from the draft below.)\n\n`
		: '';
	const { tools, apply, outcome, view } = draftTools(ctx, state, session);
	// The draft comes with the request, so the agent can start proposing without reading it first.
	const now = await view();
	const told = `${preface}${request}\n\nThe draft now${session.ops.length > 0 ? ', with your proposal so far applied' : ''}:\n${JSON.stringify(now)}`;
	const watch = new TurnWatch(ctx, `Reading the cells of ${process.title}`, () =>
		session.ops.slice(session.carried.length).flatMap((op) => opItem(op) ?? [])
	);
	const exchange: [reply: string, next: string][] = [];
	let reply = await invoke(ctx, state, told, tools, watch, exchange);
	// Small models sometimes describe their operations, or write them into the reply as JSON,
	// instead of calling apply_operations. With `lenient`, operations written out are read from the
	// reply through the same checks a call gets, and the agent is told the result so it can go on.
	for (let round = 1; ; round++) {
		const before = session.ops.length;
		const written = ctx.lenient ? operationsInText(reply) : [];
		const result = written.length > 0 ? await apply(written) : undefined;
		const proposedNone = session.ops.length === session.carried.length;
		let next: string;
		if (result !== undefined && outcome.kept === 0 && outcome.refused === 0) {
			next = `Everything in your reply is already in your proposal. Send only what is still missing, the next kind of node (facts, then steps), with apply_operations; or reply briefly if the process is complete.`;
		} else if (result !== undefined) {
			const more = session.ops.length > before ? 'still needs more' : 'needs these fixed';
			next = `I read the operations from your reply. ${result}\nIf the process ${more}, call apply_operations with them; otherwise reply briefly.`;
		} else if (expectProposal && proposedNone && round === 1) {
			const nudge = expectProposal === 'maybe' ? REPLY_NUDGE : DRAFT_NUDGE;
			next = result ? `${nudge}\n${result}` : nudge;
		} else break;
		if (round >= MAX_ROUNDS) break;
		exchange.push([reply, next]);
		reply = await invoke(ctx, state, told, tools, watch, exchange);
	}
	reply = reply.replace(/```[\s\S]*?```/g, '').trim() || 'I proposed the changes shown.';
	return {
		phase: 'draft',
		reply,
		processKey: process.key,
		ops: session.ops,
		changed: JSON.stringify(session.ops) !== JSON.stringify(session.carried)
	};
}

async function invoke(
	ctx: AgentContext,
	state: WizardState,
	request: string,
	tools: StructuredToolInterface[],
	watch: TurnWatch,
	/** The agent's earlier replies in this turn, each with what it was told next. */
	followUp: [reply: string, next: string][] = []
): Promise<string> {
	const agent = createDeepAgent({
		model: ctx.model,
		tools,
		systemPrompt: SYSTEM_PROMPT,
		middleware: [
			focus(tools.map((t) => t.name)),
			plainToolResults,
			repairedToolCalls,
			progress(watch)
		]
	});
	const drafting =
		state.phase === 'draft' ? state.processes.find((p) => p.key === state.activeKey) : undefined;
	const opening = workbookOpening(ctx.workbook, state.fileName, drafting);
	let result: { messages: unknown };
	try {
		result = await agent.invoke(
			{
				messages: [
					...history(state, request, opening),
					...followUp.flatMap(([said, next]) => [new AIMessage(said), new HumanMessage(next)])
				]
			},
			{
				recursionLimit: RECURSION_LIMIT,
				callbacks: [watch],
				...(ctx.signal ? { signal: ctx.signal } : {})
			}
		);
	} catch (error) {
		// A model that keeps calling tools is stopped; what its tools accepted so far still counts.
		if ((error as { lc_error_code?: string }).lc_error_code !== 'GRAPH_RECURSION_LIMIT')
			throw error;
		return 'I ran out of steps before I could finish this turn. What I did get done is shown for you to review; tell me what to try next.';
	}
	const last = [...(result.messages as BaseMessage[])]
		.reverse()
		.find((m) => AIMessage.isInstance(m) && textOf(m).trim() !== '');
	return last ? textOf(last).trim() : 'Done.';
}

/**
 * The first complete JSON object in `text`, when all that follows it is a little stray text, or
 * undefined. A tool input streamed as it is written is not checked by the provider, and Claude
 * sometimes ends one with a stray `</invoke>` or closing brace after the complete object.
 */
export function leadingObject(text: string): Record<string, unknown> | undefined {
	const start = text.indexOf('{');
	if (start < 0 || text.slice(0, start).trim() !== '') return undefined;
	let depth = 0;
	let quoted = false;
	for (let i = start; i < text.length; i++) {
		const c = text[i];
		if (quoted) {
			if (c === '\\') i++;
			else if (c === '"') quoted = false;
		} else if (c === '"') quoted = true;
		else if (c === '{' || c === '[') depth++;
		else if (c === '}' || c === ']') {
			depth--;
			if (depth > 0) continue;
			const rest = text.slice(i + 1).trim();
			if (rest.length > 40 || rest.includes('{')) return undefined;
			try {
				const value = JSON.parse(text.slice(start, i + 1)) as unknown;
				return typeof value === 'object' && value !== null && !Array.isArray(value)
					? (value as Record<string, unknown>)
					: undefined;
			} catch {
				return undefined;
			}
		}
	}
	return undefined;
}

/**
 * Takes a tool call whose input came with stray text after the complete JSON (see
 * `leadingObject`) as the call it is, instead of dropping it and costing a round trip to ask
 * again. The tool checks the input as it would any other.
 */
const repairedToolCalls = createMiddleware({
	name: 'RepairedToolCalls',
	wrapModelCall: async (request, handler) => {
		const message = await handler(request);
		const broken = message.invalid_tool_calls ?? [];
		if (broken.length === 0) return message;
		const repaired: NonNullable<AIMessage['tool_calls']> = [];
		const still: typeof broken = [];
		for (const call of broken) {
			const args = typeof call.args === 'string' ? leadingObject(call.args) : undefined;
			if (args && call.name && call.id) {
				repaired.push({ name: call.name, args, id: call.id, type: 'tool_call' });
			} else still.push(call);
		}
		if (repaired.length === 0) return message;
		return new AIMessage({
			content: message.content,
			...(message.id ? { id: message.id } : {}),
			additional_kwargs: message.additional_kwargs,
			response_metadata: message.response_metadata,
			...(message.usage_metadata ? { usage_metadata: message.usage_metadata } : {}),
			tool_calls: [...(message.tool_calls ?? []), ...repaired],
			invalid_tool_calls: still
		});
	}
});

/** Tells the turn's watch about each model call and tool call, so a person can see it working. */
function progress(watch: TurnWatch) {
	return createMiddleware({
		name: 'WizardProgress',
		wrapModelCall: (request, handler) => {
			watch.modelCall();
			return handler(request);
		},
		wrapToolCall: async (request, handler) => {
			const { name, args } = request.toolCall;
			watch.toolCall(name, args);
			const result = await handler(request);
			watch.toolDone(ToolMessage.isInstance(result) ? textOf(result) : '');
			return result;
		}
	});
}

/** `the Claims sheet`, `the Claims and Documents sheets`: the sheets some ranges are on. */
export function sheetsOf(ranges: unknown): string {
	const names = [
		...new Set(
			(Array.isArray(ranges) ? ranges : [])
				.map((r) => (r as { sheet?: unknown } | null)?.sheet)
				.filter((s): s is string => typeof s === 'string' && s !== '')
		)
	];
	if (names.length === 0) return 'the workbook';
	const list =
		names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} and ${names.at(-1)!}`;
	return `the ${list} ${names.length === 1 ? 'sheet' : 'sheets'}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** `3 stages, 2 roles and 4 facts`: what some items are, by kind, in the order they came. */
export function countItems(items: LiveItem[]): string {
	const counts = new Map<string, number>();
	for (const item of items) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
	const words = [...counts].map(([kind, n]) =>
		plural(n, kind === 'change' ? 'other change' : kind)
	);
	return words.length <= 1
		? (words[0] ?? 'nothing')
		: `${words.slice(0, -1).join(', ')} and ${words.at(-1)!}`;
}

/** What the agent says it is doing while it writes a call to a tool, from what it wrote so far. */
function writingActivity(name: string, items: LiveItem[]): string {
	switch (name) {
		case 'propose_split': {
			const processes = items.filter((i) => i.kind === 'process').length;
			return processes > 0
				? `Proposing ${plural(processes, 'process', 'processes')}`
				: 'Proposing processes';
		}
		case 'apply_operations':
			return items.length > 0 ? `Proposing ${countItems(items)}` : 'Proposing changes';
		case 'read_cells':
			return 'Choosing cells to read';
		case 'read_draft':
			return 'Reading the draft';
		default:
			return 'Working';
	}
}

/** What the agent is doing while one of its tools runs, from the call's input. */
function toolActivity(name: string, args: Record<string, unknown>, items: LiveItem[]): string {
	switch (name) {
		case 'read_cells':
			return `Reading ${sheetsOf(listArg(args.ranges))}`;
		case 'read_draft':
			return 'Reading the draft';
		case 'propose_split': {
			const n = items.filter((i) => i.kind === 'process').length;
			return `Checking the ${plural(n, 'proposed process', 'proposed processes')}`;
		}
		case 'apply_operations':
			return `Checking ${plural(items.length, 'proposed change')}`;
		default:
			return 'Working';
	}
}

/** A list argument, also when a model sent it as a JSON string, possibly cut short. */
function listArg(value: unknown): unknown[] {
	const parsed = typeof value === 'string' ? (parsePartialJson(value) as unknown) : value;
	return Array.isArray(parsed) ? parsed : [];
}

/** The processes and shared cells of a split, as items. */
function splitItems(input: { processes?: unknown; shared?: unknown }): LiveItem[] {
	// The whole input written as the value of `processes` (see `argsAsMeant`).
	const nested =
		typeof input.processes === 'string'
			? (parsePartialJson(input.processes) as unknown)
			: input.processes;
	if (isRecord(nested) && 'processes' in nested) return splitItems(nested);
	const titled = (kind: string) => (p: unknown) => {
		const title = (p as { title?: unknown } | null)?.title;
		return typeof title === 'string' && title.trim() ? [{ kind, title: title.trim() }] : [];
	};
	return [
		...listArg(input.processes).flatMap(titled('process')),
		...listArg(input.shared).flatMap(titled('shared'))
	];
}

/**
 * An operation as an item: a node it adds by its kind and title, any other change in a few words.
 * Undefined while it is still being written, before it says that much.
 */
function opItem(value: unknown): LiveItem | undefined {
	const op = value as { op?: unknown; node?: { core?: { kind?: unknown; title?: unknown } } };
	if (op?.op === 'add_node') {
		const core = op.node?.core;
		return typeof core?.kind === 'string' && typeof core.title === 'string' && core.title.trim()
			? { kind: core.kind, title: core.title.trim() }
			: undefined;
	}
	const checked = checkOperation(value);
	return checked.valid ? { kind: 'change', title: describeOp(checked.operation) } : undefined;
}

/** The operations of an `apply_operations` call written so far, as items. */
function opsItems(args: { operations?: unknown }): LiveItem[] {
	return listArg(args.operations).flatMap((o) => opItem(o) ?? []);
}

/** How often what the model is writing is read again, at most. */
const LIVE_EVERY_MS = 150;

/**
 * Follows one turn of the agent as it runs and tells the person what it is doing (`onProgress`)
 * and what it has written so far (`onLive`): its words, and what it is proposing, read from its
 * tool calls while they are still being written. It is a callback handler that asks for the
 * model's output as a stream; a model that cannot stream is followed call by call.
 */
class TurnWatch extends BaseCallbackHandler {
	name = 'WizardTurnWatch';
	readonly lc_prefer_streaming = true;
	private calls = 0;
	private refused = false;
	private text = '';
	/** The text, tool calls and thinking of the model call being written. */
	private writing = { text: '', thinking: false, tools: [] as { name: string; args: string }[] };
	/** Items of the tool call being written or run, before its tool has taken them. */
	private pending: LiveItem[] = [];
	private readAt = 0;

	constructor(
		private readonly ctx: AgentContext,
		/** What the first model call of the turn is doing, such as `Reading the spreadsheet`. */
		private readonly opening: string,
		/** What the turn has proposed so far that its tools have taken. */
		private readonly taken: () => LiveItem[]
	) {
		super();
	}

	/** A model call starts. */
	modelCall() {
		this.calls++;
		this.writing = { text: '', thinking: false, tools: [] };
		this.pending = [];
		this.say(
			this.calls === 1
				? this.opening
				: this.refused
					? 'Fixing what was refused'
					: 'Thinking it over'
		);
	}

	/** A tool starts running with the model's finished call. */
	toolCall(name: string, args: Record<string, unknown>) {
		this.pending =
			name === 'propose_split'
				? splitItems(args)
				: name === 'apply_operations'
					? opsItems(args)
					: [];
		this.say(toolActivity(name, args, this.pending));
	}

	/** A tool has answered; what it took now shows from `taken`. */
	toolDone(result: string) {
		this.refused = /^(Not recorded|Nothing applied|Nothing read|Error)/.test(result.trim());
		this.pending = [];
		this.show();
	}

	override handleLLMNewToken(
		_token: string,
		_idx: NewTokenIndices,
		_runId: string,
		_parentRunId?: string,
		_tags?: string[],
		fields?: HandleLLMNewTokenCallbackFields
	) {
		const message = fields?.chunk && 'message' in fields.chunk ? fields.chunk.message : undefined;
		if (!message || !AIMessageChunk.isInstance(message)) return;
		const w = this.writing;
		if (Array.isArray(message.content)) {
			for (const block of message.content) {
				if (block.type === 'thinking' || block.type === 'redacted_thinking') w.thinking = true;
				else if (block.type === 'text' && 'text' in block) w.text += String(block.text);
			}
		} else w.text += message.content;
		for (const chunk of message.tool_call_chunks ?? []) {
			const index = chunk.index ?? w.tools.length - 1;
			const call = (w.tools[index] ??= { name: '', args: '' });
			if (chunk.name) call.name = chunk.name;
			if (chunk.args) call.args += chunk.args;
		}
		const now = Date.now();
		if (now - this.readAt < LIVE_EVERY_MS) return;
		this.readAt = now;
		this.read();
	}

	/** A model call has finished: what it wrote last is read even when it came within the wait. */
	override handleLLMEnd() {
		this.read();
	}

	/** Reads what the model call has written so far and says what it is doing. */
	private read() {
		const w = this.writing;
		const said = w.text.replace(/```[\s\S]*?(?:```|$)/g, '').trim();
		if (said) this.text = said;
		const last = w.tools.at(-1);
		if (last?.name) {
			const args = (parsePartialJson(last.args || '{}') ?? {}) as Record<string, unknown>;
			this.pending = w.tools.flatMap((t) => {
				if (t === last) {
					return t.name === 'propose_split'
						? splitItems(args)
						: t.name === 'apply_operations'
							? opsItems(args)
							: [];
				}
				const done = (parsePartialJson(t.args || '{}') ?? {}) as Record<string, unknown>;
				return t.name === 'apply_operations' ? opsItems(done) : [];
			});
			this.say(writingActivity(last.name, this.pending));
		} else if (said) this.say('Writing');
		else if (w.thinking) this.say('Thinking it over');
		else this.show();
	}

	private say(activity: string) {
		this.ctx.onProgress?.(activity);
		this.show();
	}

	private show() {
		if (!this.ctx.onLive) return;
		const pending = this.pending;
		// A split is proposed whole, so the one being written replaces the one taken before it.
		const split = pending.some((i) => i.kind === 'process' || i.kind === 'shared');
		this.ctx.onLive({ text: this.text, items: split ? pending : [...this.taken(), ...pending] });
	}
}

/**
 * Shows the model only the wizard's own tools and its own instructions. The deepagents harness
 * still runs the loop, but its built-in tools (files, to-do lists, subagents) only distract a model
 * from the one job, small local models most of all. A call to a hidden tool is answered with an
 * error.
 */
function focus(names: string[]) {
	const allowed = new Set(names);
	const system = new SystemMessage(SYSTEM_PROMPT);
	return createMiddleware({
		name: 'WizardFocus',
		wrapModelCall: (request, handler) =>
			handler({
				...request,
				systemMessage: system,
				systemPrompt: SYSTEM_PROMPT,
				tools: request.tools.filter(
					(t) => typeof t !== 'object' || !('name' in t) || allowed.has(String(t.name))
				)
			}),
		wrapToolCall: (request, handler) => {
			const { name, id, args } = request.toolCall;
			if (allowed.has(name)) {
				const toolCall = { ...request.toolCall, args: argsAsMeant(name, args) };
				return handler({ ...request, toolCall });
			}
			return new ToolMessage({
				content: `Error: ${name} is not available. Use ${[...allowed].join(', ')}.`,
				tool_call_id: id ?? '',
				name,
				status: 'error'
			});
		}
	});
}

/**
 * Sends tool results to the model as plain text. Some tools answer with content blocks, which not
 * every chat model accepts (Ollama's, for one), and text is all the wizard's tools return.
 */
const plainToolResults = createMiddleware({
	name: 'PlainToolResults',
	wrapModelCall: (request, handler) =>
		handler({
			...request,
			messages: request.messages.map((m) =>
				ToolMessage.isInstance(m) && typeof m.content !== 'string'
					? new ToolMessage({
							content: textOf(m),
							tool_call_id: m.tool_call_id,
							...(m.name ? { name: m.name } : {}),
							...(m.status ? { status: m.status } : {})
						})
					: m
			)
		})
});

/** The text of a message, without thinking or tool-use blocks. */
export function textOf(message: BaseMessage): string {
	const { content } = message;
	if (typeof content === 'string') return content;
	return content
		.map((block) => (block.type === 'text' && 'text' in block ? String(block.text) : ''))
		.join('');
}

/**
 * The conversation so far as alternating messages, opening with the workbook (see
 * `workbookOpening`) and ending with
 * `request`. Notes of what the person did outside the chat, and the fate of each proposal, are told
 * to the agent in brackets.
 */
export function history(state: WizardState, request: string, opening?: string): BaseMessage[] {
	const upload = `I uploaded ${state.fileName}.`;
	const turns: { role: 'user' | 'assistant'; text: string }[] = [
		{ role: 'user', text: opening ? `${upload} ${opening}` : upload }
	];
	const push = (role: 'user' | 'assistant', text: string) => {
		const last = turns.at(-1)!;
		if (last.role === role) last.text = `${last.text}\n\n${text}`;
		else turns.push({ role, text });
	};
	for (const entry of state.messages) {
		if (entry.role === 'user') push('user', entry.text);
		else if (entry.role === 'note') push('user', `[${entry.text}]`);
		else {
			push('assistant', entry.text);
			const fate = entry.card?.type === 'turn' ? turnFate(state, entry.card.turnId) : undefined;
			if (fate) push('user', `[${fate}]`);
		}
	}
	push('user', request);
	return turns.map((t) => (t.role === 'user' ? new HumanMessage(t.text) : new AIMessage(t.text)));
}

/** What became of a proposal, as the agent is told: `Your proposal of 7 operations was accepted.` */
function turnFate(state: WizardState, turnId: string): string | undefined {
	const turn = state.turns.find((t) => t.id === turnId);
	if (!turn) return undefined;
	const what = `Your proposal of ${turn.ops.length} operations`;
	switch (turn.status) {
		case 'pending':
			return `${what} is waiting for me to accept or reject it.`;
		case 'revised':
			return `${what} was replaced by your next one.`;
		default:
			return `${what} was ${turn.status}.`;
	}
}

/**
 * Counts refused tool calls in a row. Small models tend to repeat a refused call unchanged, so
 * after a few the refusal also tells the agent to stop and explain instead.
 */
function refusals() {
	let streak = 0;
	let last = '';
	return {
		refuse(input: unknown, message: string): string {
			const same = JSON.stringify(input) === last;
			last = JSON.stringify(input);
			streak++;
			if (streak >= MAX_REFUSALS) {
				return `${message}\n\nThat is ${streak} refusals in a row. Stop calling tools now and tell the person in one or two sentences what you could not do.`;
			}
			return same
				? `${message}\n\nThis is the same input as your last refused call; change it as the reasons say.`
				: message;
		},
		accept() {
			streak = 0;
			last = '';
		}
	};
}

const range = z.object({
	sheet: z.string().describe('The sheet name, exactly as in the workbook'),
	range: z.string().describe('An A1 address or range, such as A2:F23')
});

/** Arguments of the wizard's tools that are lists, and within their items, lists of cells. */
const LIST_ARGS: Record<string, { lists: string[]; within?: string }> = {
	read_cells: { lists: ['ranges'] },
	propose_split: { lists: ['processes', 'shared'], within: 'sources' },
	apply_operations: { lists: ['operations'] }
};

/** A list or object a model sent as a JSON string, as what it holds; anything else as it is. */
function unstring(value: unknown): unknown {
	if (typeof value !== 'string' || !/^\s*[[{]/.test(value)) return value;
	try {
		const parsed = JSON.parse(value) as unknown;
		return typeof parsed === 'object' && parsed !== null ? parsed : value;
	} catch {
		return value;
	}
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * A tool call's arguments as the model meant them. Claude sometimes sends a list of objects as a
 * JSON string, or the whole input, as an object or a JSON string, as the value of its first
 * argument (`{"processes": "{\"processes\": [...], \"shared\": [...]}"}`); both are read as what
 * they hold. The tool then checks the arguments as usual.
 */
export function argsAsMeant(name: string, args: Record<string, unknown>): Record<string, unknown> {
	const shape = LIST_ARGS[name];
	if (!shape) return args;
	const keys = Object.keys(args);
	if (keys.length === 1) {
		const whole = unstring(args[keys[0]!]);
		if (isRecord(whole) && keys[0]! in whole) return argsAsMeant(name, whole);
	}
	const out = { ...args };
	for (const key of shape.lists) {
		if (!(key in out)) continue;
		const list = unstring(out[key]);
		const within = shape.within;
		out[key] =
			within && Array.isArray(list)
				? list.map((item: unknown) =>
						isRecord(item) && within in item ? { ...item, [within]: unstring(item[within]) } : item
					)
				: list;
	}
	return out;
}

/** Reading cells of the workbook by range, in either phase. */
function readCellsTool(ctx: AgentContext): StructuredToolInterface {
	return tool(
		async ({ ranges }: { ranges: CellRange[] }) => {
			const problems: string[] = [];
			const found: CellRange[] = [];
			for (const r of ranges) {
				const problem = rangeProblem(ctx.workbook, plainRange(r));
				if (problem) problems.push(`${formatRange(r)}: ${problem}`);
				else found.push(plainRange(r));
			}
			const notRead = problems.length ? `Not read:\n- ${problems.join('\n- ')}` : '';
			if (found.length === 0) return `Nothing read. ${notRead || 'Name at least one range.'}`;
			const text = rangesText(ctx.workbook, found, READ_CHARS);
			return notRead ? `${text}\n\n${notRead}` : text;
		},
		{
			name: 'read_cells',
			description:
				'Read cells of the workbook, one line per row with every cell’s address. Ask for only the cells you need, several ranges in one call.',
			schema: z.object({
				ranges: z
					.array(range)
					.describe('The ranges to read, such as {"sheet": "Claims", "range": "A1:F40"}')
			})
		}
	);
}

// The split phase

function splitTool(
	ctx: AgentContext,
	state: WizardState,
	collected: { split?: Extract<AgentOutcome, { phase: 'split' }>['split'] }
): StructuredToolInterface {
	const guard = refusals();
	return tool(
		async (input) => {
			const { processes, shared } = input;
			const problems: string[] = [];
			const check = (where: string, sources: z.infer<typeof range>[]) => {
				if (sources.length === 0) problems.push(`${where} needs at least one range of cells`);
				for (const s of sources) {
					const problem = rangeProblem(ctx.workbook, plainRange(s));
					if (problem) problems.push(`${where}: ${problem}`);
				}
			};
			if (processes.length === 0) problems.push('propose at least one process');
			processes.forEach((p, i) => check(`process ${i + 1} ("${p.title}")`, p.sources));
			(shared ?? []).forEach((s, i) => check(`shared ${i + 1} ("${s.title}")`, s.sources));
			if (problems.length) {
				return guard.refuse(
					input,
					`Not recorded. Fix these and call propose_split again:\n- ${problems.join('\n- ')}`
				);
			}
			guard.accept();
			const clean = (sources: z.infer<typeof range>[]) => sources.map(plainRange);
			collected.split = {
				processes: processes.map((p) => ({
					title: p.title.trim(),
					summary: p.summary.trim(),
					sources: clean(p.sources)
				})),
				shared: (shared ?? []).map((s) => ({
					title: s.title.trim(),
					summary: s.summary.trim(),
					sources: clean(s.sources)
				}))
			};
			return `Recorded ${processes.length} processes for ${state.fileName}. The person will review them; reply briefly.`;
		},
		{
			name: 'propose_split',
			// The processes show as they are written (model.ts).
			metadata: { streamInput: true },
			description:
				'Propose how to split the workbook into processes. Replaces any earlier proposal, so always send the whole split.',
			schema: z.object({
				processes: z
					.array(
						z.object({
							title: z.string().describe('A short plain name, such as "Birth registration"'),
							summary: z.string().describe('One line on what the process covers'),
							sources: z.array(range).describe('The cells the process is drafted from')
						})
					)
					.describe('The processes, in the order they usually happen'),
				shared: z
					.array(
						z.object({
							title: z.string(),
							summary: z.string(),
							sources: z.array(range)
						})
					)
					.optional()
					.describe('Cells several processes draw on, such as a list of documents')
			})
		}
	);
}

// The draft phase

interface DraftSession {
	processKey: string;
	definitionId: string;
	baseRevision: number;
	head: DefinitionDocument;
	/** The pending proposal's operations the turn started from. */
	carried: Operation[];
	/** The proposal so far: carried operations, then those applied this turn. */
	ops: Operation[];
	/** Why the carried operations were dropped, when the draft changed under them. */
	dropped?: string;
	/** Serialises tool calls, which the agent may make in parallel. */
	queue: Promise<unknown>;
}

async function draftSession(
	ctx: AgentContext,
	state: WizardState,
	processKey: string
): Promise<DraftSession> {
	const process = processOf(state, processKey);
	const head = await ctx.drafts.head(process.definitionId);
	if (!head.ok) throw new Error(`Cannot read ${process.title}: ${head.reason}`);
	const carried = pendingTurn(state, processKey)?.ops ?? [];
	const session: DraftSession = {
		processKey,
		definitionId: process.definitionId,
		baseRevision: head.revision,
		head: head.document,
		carried: [],
		ops: [],
		queue: Promise.resolve()
	};
	if (carried.length > 0) {
		const checked = await ctx.drafts.preview(process.definitionId, head.revision, carried);
		if (checked.ok) {
			session.carried = carried;
			session.ops = [...carried];
		} else session.dropped = checked.reason;
	}
	return session;
}

const META_SCHEMA = 'https://json-schema.org/draft/2020-12/schema';

/**
 * Replaces references to the JSON Schema meta-schema, which a fact's schema is checked against,
 * with a plain object: tool schemas must be self-contained. The model still checks fact schemas.
 */
function withoutMetaSchema(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(withoutMetaSchema);
	if (typeof value !== 'object' || value === null) return value;
	if ((value as { $ref?: unknown }).$ref === META_SCHEMA) {
		return { type: 'object', description: 'A JSON Schema for the value' };
	}
	return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, withoutMetaSchema(v)]));
}

/**
 * Drops top-level fields an operation does not define, such as an empty `changes` some models add
 * to every operation. The operation is then checked as usual.
 */
export function tidyOperation(value: unknown): unknown {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
	const op = (value as { op?: unknown }).op;
	const schema =
		typeof op === 'string' ? OPERATION_SCHEMAS[op as keyof typeof OPERATION_SCHEMAS] : undefined;
	if (!schema) return value;
	const fields = Object.keys((schema as { properties: Record<string, unknown> }).properties);
	const tidy = Object.fromEntries(Object.entries(value).filter(([key]) => fields.includes(key)));
	// Core fields written beside the core, as `{id, kind, title, core: {source}}` or with no core at
	// all, are taken to be part of it, and a condition with a null expression keeps just its prose.
	// Who may do a step is never filled in or guessed: one that leaves it out is refused.
	const node = tidy.node as Record<string, unknown> | undefined;
	if (op === 'add_node' && node && typeof node === 'object' && !Array.isArray(node)) {
		const { content, data, core, ...beside } = node;
		if (Object.keys(beside).length > 0) {
			tidy.node = {
				core: { ...beside, ...(typeof core === 'object' && core !== null ? core : {}) },
				...(content === undefined ? {} : { content }),
				...(data === undefined ? {} : { data })
			};
		}
		const full = (tidy.node as { core?: Record<string, unknown> }).core;
		if (full && (full.kind === 'step' || full.kind === 'decision')) {
			const when = full.when as { expr?: unknown } | undefined;
			if (when && typeof when === 'object' && when.expr === null) delete when.expr;
		}
	}
	return tidy;
}

/**
 * Operations a model wrote into its reply as JSON, in a code block or bare, instead of sending
 * them with apply_operations. Empty when the reply holds none.
 */
export function operationsInText(text: string): unknown[] {
	// Code blocks, including one the model did not close; else the reply itself.
	const candidates = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)(?:```|$)/g)].map((m) => m[1]!);
	if (candidates.length === 0) candidates.push(text);
	const found: unknown[] = [];
	for (const candidate of candidates) {
		const start = candidate.search(/[[{]/);
		if (start < 0) continue;
		const parsed = looseJson(candidate.slice(start));
		const list = Array.isArray(parsed)
			? parsed
			: Array.isArray((parsed as { operations?: unknown } | undefined)?.operations)
				? (parsed as { operations: unknown[] }).operations
				: [parsed];
		found.push(...list.filter((v) => typeof v === 'object' && v !== null && 'op' in v));
	}
	return found;
}

/**
 * Parses JSON as models write it: line comments and trailing commas are dropped, and a list cut
 * off part-way keeps the items that were complete. Undefined when nothing can be read.
 */
function looseJson(text: string): unknown {
	const cleaned = text
		.trim()
		.replace(/^\s*\/\/.*$/gm, '')
		.replace(/,(\s*[\]}])/g, '$1');
	try {
		return JSON.parse(cleaned) as unknown;
	} catch {
		if (!cleaned.startsWith('[')) return undefined;
		// Keep the items before the cut: close the list after the last complete item.
		for (let end = cleaned.lastIndexOf('}'); end > 0; end = cleaned.lastIndexOf('}', end - 1)) {
			try {
				return JSON.parse(`${cleaned.slice(0, end + 1)}]`) as unknown;
			} catch {
				// Not the end of an item; try the one before.
			}
		}
		return undefined;
	}
}

/** Whether two nodes are the same apart from which cells they cite, ignoring key order. */
function sameNode(a: Node, b: Node): boolean {
	const bare = (n: Node) => ({ ...n, core: { ...n.core, source: undefined } });
	return sameJson(bare(a), bare(b));
}

function sameJson(a: unknown, b: unknown): boolean {
	const canonical = (v: unknown): unknown =>
		Array.isArray(v)
			? v.map(canonical)
			: typeof v === 'object' && v !== null
				? Object.fromEntries(
						Object.entries(v)
							.filter(([, x]) => x !== undefined)
							.sort(([x], [y]) => (x < y ? -1 : 1))
							.map(([k, x]) => [k, canonical(x)])
					)
				: v;
	return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

/** `add_node step.x`, `link step.x requires fact.y`: an operation in a few words. */
function describeOp(op: Operation): string {
	switch (op.op) {
		case 'add_node':
			return `add ${op.node.core.id}`;
		case 'link':
		case 'unlink':
			return `${op.op} ${op.from} ${op.edge} ${op.to}`;
		default:
			return `${op.op} ${op.id}`;
	}
}

/** The node operations' JSON Schemas, as `anyOf` variants sharing one set of `$defs`. */
function operationVariants(): {
	variants: Record<string, unknown>[];
	defs: Record<string, unknown>;
} {
	const defs: Record<string, unknown> = {};
	const variants = Object.values(OPERATION_SCHEMAS).map((schema) => {
		const rest = { ...(withoutMetaSchema(schema) as Record<string, unknown>) };
		Object.assign(defs, rest.$defs as Record<string, unknown> | undefined);
		delete rest.$schema;
		delete rest.$defs;
		return rest;
	});
	return { variants, defs };
}

/**
 * `apply_operations`'s input: a list of node operations. The model is shown every operation's
 * JSON Schema (ADR 0019), but LangChain is not asked to enforce them: each operation is checked
 * by the tool itself (tidied first when lenient), which explains a refusal in plain language the
 * model can act on.
 */
function operationsInput() {
	const { variants, defs } = operationVariants();
	return z
		.object({
			operations: z
				.array(z.unknown().meta({ anyOf: variants }))
				.describe('Node operations, applied in order as part of this turn’s proposal')
		})
		.meta({ $defs: defs });
}

/** The JSON Schema the model is shown for `apply_operations`. */
export function operationsSchema(): Record<string, unknown> {
	return z.toJSONSchema(operationsInput()) as Record<string, unknown>;
}

function draftTools(
	ctx: AgentContext,
	state: WizardState,
	session: DraftSession
): {
	tools: StructuredToolInterface[];
	apply: (operations: unknown[]) => Promise<string>;
	outcome: { kept: number; refused: number; skipped: number };
	view: () => Promise<Record<string, unknown>>;
} {
	const serial = <T>(work: () => Promise<T>): Promise<T> => {
		const run = session.queue.then(work, work);
		session.queue = run.catch(() => undefined);
		return run;
	};
	const process = processOf(state, session.processKey);
	const shared = state.split?.shared ?? [];
	const guard = refusals();
	// With `lenient`, a bare address in a source is taken to be on the process's sheet when it has
	// only one, and the source's document is the upload.
	const sheets = new Set(process.sources.map((s) => s.sheet));
	const sheet = sheets.size === 1 ? [...sheets][0] : undefined;
	const withSource = (value: unknown): unknown => {
		const op = value as { op?: unknown; node?: { core?: Record<string, unknown> } };
		if (op?.op !== 'add_node' || typeof op.node?.core !== 'object' || op.node.core === null)
			return value;
		const core = op.node.core;
		if (core.source === undefined) return value;
		return {
			...op,
			node: {
				...op.node,
				core: { ...core, source: completeSource(core.source, state.fileName, sheet) }
			}
		};
	};
	/** The process being drafted, with the proposal so far applied, as the agent is shown it. */
	const view = async () => {
		const preview =
			session.ops.length > 0
				? await ctx.drafts.preview(session.definitionId, session.baseRevision, session.ops)
				: undefined;
		const document = preview?.ok ? preview.document : session.head;
		return {
			process: process.title,
			draftFrom: process.sources.map(describeRange),
			sharedCells: shared.map((s) => ({ title: s.title, cells: s.sources.map(formatRange) })),
			sourceDoc: state.fileName,
			yourOperationsSoFar: session.ops.length,
			nodes: document.nodes
		};
	};
	const readDraft = tool(() => serial(async () => JSON.stringify(await view(), null, 1)), {
		name: 'read_draft',
		description:
			'Read the process being drafted, as JSON, with the operations you proposed so far applied.',
		schema: z.object({})
	});
	/** The draft as the proposal so far would leave it. */
	const proposalDocument = async (): Promise<DefinitionDocument> => {
		if (session.ops.length === 0) return session.head;
		const preview = await ctx.drafts.preview(
			session.definitionId,
			session.baseRevision,
			session.ops
		);
		return preview.ok ? preview.document : session.head;
	};
	/** How the latest apply went, for the turn to decide what to tell the agent next. */
	const outcome = { kept: 0, refused: 0, skipped: 0 };
	const apply = (list: unknown[]) =>
		serial(async () => {
			Object.assign(outcome, { kept: 0, refused: 0, skipped: 0 });
			const input = { operations: list };
			if (list.length === 0) return guard.refuse(input, 'Refused: send at least one operation.');
			// Each operation is checked on its own shape and source, then against the draft with
			// the proposal so far; those that pass are kept and each refused one says why.
			const refused: string[] = [];
			const checked: { op: Operation; label: string }[] = [];
			// Nodes the proposal already has: sending one again unchanged is not an error.
			const current = await proposalDocument();
			const existing = new Map(current.nodes.map((n) => [n.core.id as string, n]));
			const skipped: string[] = [];
			list.forEach((value, i) => {
				const result = checkOperation(ctx.lenient ? withSource(tidyOperation(value)) : value);
				if (!result.valid) {
					refused.push(`operation ${i + 1}: ${result.errors.map((e) => e.message).join('; ')}`);
					return;
				}
				const op = result.operation;
				const label = `operation ${i + 1} (${describeOp(op)})`;
				const problem =
					op.op === 'add_node'
						? sourceProblem(ctx.workbook, state.fileName, op.node.core.source)
						: undefined;
				const already = op.op === 'add_node' ? existing.get(op.node.core.id) : undefined;
				if (problem) refused.push(`${label}: ${problem}`);
				else if (already && op.op === 'add_node' && sameNode(already, op.node)) {
					skipped.push(op.node.core.id);
				} else if (already) {
					refused.push(
						`${label}: ${already.core.id} is already in the draft; leave it out, or change it with update_core`
					);
				} else {
					checked.push({ op, label });
					if (op.op === 'add_node') existing.set(op.node.core.id, op.node);
				}
			});
			const preview = (ops: Operation[]) =>
				ctx.drafts.preview(session.definitionId, session.baseRevision, ops);
			let kept = checked.map((c) => c.op);
			let last = kept.length > 0 ? await preview([...session.ops, ...kept]) : undefined;
			if (last && !last.ok) {
				// Not all of them fit: keep, in order, each one that fits after those kept before it.
				kept = [];
				last = undefined;
				for (const { op, label } of checked) {
					const tried = await preview([...session.ops, ...kept, op]);
					if (tried.ok) {
						kept.push(op);
						last = tried;
					} else {
						const details = tried.problems.length ? ` (${tried.problems.join('; ')})` : '';
						refused.push(`${label}: ${tried.reason}${details}`);
					}
				}
			}
			const refusals = refused.length
				? `\nRefused, so not applied; fix and send these again:\n- ${refused.join('\n- ')}`
				: '';
			Object.assign(outcome, {
				kept: kept.length,
				refused: refused.length,
				skipped: skipped.length
			});
			const alreadyThere = skipped.length
				? `\nAlready in the draft, so left as they are: ${skipped.join(', ')}.`
				: '';
			if (kept.length === 0 || !last?.ok) {
				return guard.refuse(input, `Nothing applied.${alreadyThere}${refusals}`);
			}
			if (refused.length === 0) guard.accept();
			session.ops = [...session.ops, ...kept];
			const blocking = last.warnings.filter((w) => w.severity === 'error');
			const notes = blocking.length
				? `\nStill blocks publishing:\n- ${blocking.map((w) => w.message).join('\n- ')}`
				: '\nNothing blocks publishing.';
			return `Applied ${kept.length} of ${list.length} operations; your proposal now has ${session.ops.length}. Compared with the saved draft it would make ${last.changes.length} changes.${alreadyThere}${refusals}${notes}`;
		});
	const applyOperations = tool((input: { operations: unknown[] }) => apply(input.operations), {
		name: 'apply_operations',
		// Its input is a whole process's operations, so it is shown as it is written (model.ts).
		metadata: { streamInput: true },
		description:
			'Apply node operations to the process being drafted, as part of this turn’s proposal. Each is checked like an edit of the draft: those that pass are applied, and each refused one is listed with the reason, for you to fix and send again. Every add_node needs core.source pointing at its cells.',
		schema: operationsInput()
	});
	return { tools: [readCellsTool(ctx), readDraft, applyOperations], apply, outcome, view };
}
