/**
 * The authoring agent: a deepagents agent (ADR 0012) with the workbook in its virtual filesystem
 * and three tools of its own. In the split phase it may only propose a split; in the draft phase it
 * may only read the process being drafted and apply node operations to it, each checked by the
 * store's definition service as an edit by the signed-in person and collected into one proposal
 * the person accepts or rejects (ADR 0011). Nothing it does is saved by the agent itself.
 */
import {
	AIMessage,
	HumanMessage,
	SystemMessage,
	ToolMessage,
	type BaseMessage
} from '@langchain/core/messages';
import type { BaseLanguageModel } from '@langchain/core/language_models/base';
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
import { workbookOpening, workbookText } from './context.js';
import type { DraftAccess } from './drafts.js';
import { SYSTEM_PROMPT } from './prompt.js';
import {
	completeSource,
	describeRange,
	formatRange,
	plainRange,
	rangeProblem,
	sourceProblem
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
	/** Told what the agent is doing as it goes, such as `Reading the draft`. */
	onProgress?: (activity: string) => void;
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

const WORKBOOK_FILE = '/workbook.md';
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
		const tools = [splitTool(ctx, state, collected)];
		let reply = await invoke(ctx, state, request, tools);
		if (expectProposal === true && !collected.split) {
			reply = await invoke(ctx, state, request, tools, [[reply, SPLIT_NUDGE]]);
		}
		return { phase: 'split', reply, ...(collected.split ? { split: collected.split } : {}) };
	}
	const process = processOf(state, state.activeKey);
	const session = await draftSession(ctx, state, process.key);
	const preface = session.dropped
		? `(Your earlier proposal no longer fits the draft, which changed since: ${session.dropped}. Start again from read_draft.)\n\n`
		: '';
	const { tools, apply, outcome } = draftTools(ctx, state, session);
	const exchange: [reply: string, next: string][] = [];
	let reply = await invoke(ctx, state, preface + request, tools, exchange);
	// Small models sometimes describe their operations, or write them into the reply as JSON,
	// instead of calling apply_operations. Operations written out are read from the reply through
	// the same checks a call gets, and the agent is told the result so it can go on.
	for (let round = 1; ; round++) {
		const before = session.ops.length;
		const written = operationsInText(reply);
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
		reply = await invoke(ctx, state, preface + request, tools, exchange);
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
	/** The agent's earlier replies in this turn, each with what it was told next. */
	followUp: [reply: string, next: string][] = []
): Promise<string> {
	const agent = createDeepAgent({
		model: ctx.model,
		tools,
		systemPrompt: SYSTEM_PROMPT,
		middleware: [focus(tools.map((t) => t.name)), plainToolResults, progress(ctx)]
	});
	const workbook = workbookText(ctx.workbook, state.fileName);
	const drafting =
		state.phase === 'draft' ? state.processes.find((p) => p.key === state.activeKey) : undefined;
	const opening = workbookOpening(ctx.workbook, state.fileName, drafting);
	const now = new Date().toISOString();
	let result: { messages: unknown };
	try {
		result = await agent.invoke(
			{
				messages: [
					...history(state, request, opening),
					...followUp.flatMap(([said, next]) => [new AIMessage(said), new HumanMessage(next)])
				],
				files: {
					[WORKBOOK_FILE]: {
						content: workbook,
						mimeType: 'text/markdown',
						created_at: now,
						modified_at: now
					}
				}
			},
			{ recursionLimit: RECURSION_LIMIT, ...(ctx.signal ? { signal: ctx.signal } : {}) }
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

const TOOL_ACTIVITY: Record<string, string> = {
	read_file: 'Reading the workbook',
	propose_split: 'Checking the proposed processes',
	read_draft: 'Reading the draft',
	apply_operations: 'Checking the proposed changes'
};

/** Reports each model call and tool call to `ctx.onProgress`, so a person can see it working. */
function progress(ctx: AgentContext) {
	let calls = 0;
	return createMiddleware({
		name: 'WizardProgress',
		wrapModelCall: (request, handler) => {
			calls++;
			ctx.onProgress?.(calls === 1 ? 'Reading the spreadsheet' : `Thinking (step ${calls})`);
			return handler(request);
		},
		wrapToolCall: (request, handler) => {
			ctx.onProgress?.(TOOL_ACTIVITY[request.toolCall.name] ?? 'Working');
			return handler(request);
		}
	});
}

/** The one deepagents built-in tool the wizard keeps: reading the workbook from its file. */
const KEPT_BUILTINS = ['read_file'];

/**
 * Shows the model only the wizard's own tools (and `read_file`) and its own instructions. The
 * deepagents harness still runs the loop and holds the workbook in its filesystem, but its other
 * built-in tools (writing files, to-do lists, subagents) only distract a model from the one job,
 * small local models most of all. A call to a hidden tool is answered with an error.
 */
function focus(names: string[]) {
	const allowed = new Set([...names, ...KEPT_BUILTINS]);
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
			const { name, id } = request.toolCall;
			if (allowed.has(name)) return handler(request);
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

// The split phase

const range = z.object({
	sheet: z.string().describe('The sheet name, exactly as in the workbook'),
	range: z.string().describe('An A1 address or range, such as A2:F23')
});

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
	// all, are taken to be part of it. A step or decision that says nothing of who may do it is
	// left to people (`actor: "human"`), the policy that grants an agent the least, and a condition
	// with a null expression keeps just its prose.
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
			// A role given as the actor, as `{"kind": "role.parent"}` or `"role.parent"`, is the role.
			const actor = full.actor as unknown;
			const named = typeof actor === 'string' ? actor : (actor as { kind?: unknown } | null)?.kind;
			if (typeof named === 'string' && named.startsWith('role.')) {
				full.role ??= named;
				full.actor = 'human';
			}
			full.actor ??= 'human';
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
 * JSON Schema (ADR 0019), but LangChain is not asked to enforce them: each operation is tidied and
 * checked by the tool itself, which explains a refusal in plain language the model can act on.
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
} {
	const serial = <T>(work: () => Promise<T>): Promise<T> => {
		const run = session.queue.then(work, work);
		session.queue = run.catch(() => undefined);
		return run;
	};
	const process = processOf(state, session.processKey);
	const shared = state.split?.shared ?? [];
	const guard = refusals();
	// A bare address in a source is taken to be on the process's sheet when it has only one.
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
	const readDraft = tool(
		() =>
			serial(async () => {
				const preview =
					session.ops.length > 0
						? await ctx.drafts.preview(session.definitionId, session.baseRevision, session.ops)
						: undefined;
				const document = preview?.ok ? preview.document : session.head;
				return JSON.stringify(
					{
						process: process.title,
						draftFrom: process.sources.map(describeRange),
						sharedCells: shared.map((s) => ({ title: s.title, cells: s.sources.map(formatRange) })),
						sourceDoc: state.fileName,
						yourOperationsSoFar: session.ops.length,
						nodes: document.nodes
					},
					null,
					1
				);
			}),
		{
			name: 'read_draft',
			description:
				'Read the process being drafted, as JSON, with the operations you proposed so far applied.',
			schema: z.object({})
		}
	);
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
				const result = checkOperation(withSource(tidyOperation(value)));
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
		description:
			'Apply node operations to the process being drafted, as part of this turn’s proposal. Each is checked like an edit of the draft: those that pass are applied, and each refused one is listed with the reason, for you to fix and send again. Every add_node needs core.source pointing at its cells.',
		schema: operationsInput()
	});
	return { tools: [readDraft, applyOperations], apply, outcome };
}
