/**
 * Spreadsheet imports (ADR 0011), on the server: the session lives in the store, the agent runs
 * here, and every definition it reads or edits goes through the store's definition service as the
 * signed-in user (`storeDrafts`). The page only ever sees `WizardView`.
 */
import {
	createWizardSession,
	listWizardSessions,
	loadWizardSession,
	previewDefinitionEdit,
	publishDefinition,
	saveWizardSession,
	type Actor,
	type Refusal
} from '@casebook/store';
import { readWorkbook, SheetImportError, type Workbook } from '@casebook/sheet-import';
import {
	createChatModel,
	describeRange,
	mergeProcesses,
	modelName,
	modelProblem,
	modelSpec,
	pendingTurn,
	processOf,
	renameProcess,
	splitProcess,
	startState,
	storeDrafts,
	wizard,
	WizardError,
	type WizardState
} from '@casebook/wizard-agent';
import type { Change, DefinitionDocument } from '@casebook/model';
import type {
	ImportSummary,
	ProposalChange,
	ProposalPreview,
	WizardAction,
	WizardView
} from '$lib/wizard/types';
import { getDb } from './db';
import { isRunning, progressOf, runTurn, TurnTimeout, turnTimeoutSeconds } from './wizard-runs';

/** Requests that run the agent, with a timeout (one at a time on Ollama). */
const AGENT_ACTIONS = new Set<WizardAction['action']>(['split', 'reply', 'draft']);

/** Largest workbook accepted for import. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export type Outcome<T> = ({ ok: true } & T) | { ok: false; status: number; reason: string };

const STATUS: Partial<Record<Refusal['code'], number>> = {
	'access-denied': 403,
	'not-found': 404,
	'stale-draft': 409
};

const failed = (r: Refusal) => ({
	ok: false as const,
	status: STATUS[r.code] ?? 422,
	reason: r.reason
});

/** Reads an uploaded workbook and starts an import of it in a namespace. */
export async function startImport(
	actor: Actor,
	input: { namespaceId: string; fileName: string; bytes: Uint8Array }
): Promise<Outcome<{ id: string }>> {
	if (input.bytes.byteLength > MAX_UPLOAD_BYTES) {
		return { ok: false, status: 413, reason: 'The spreadsheet is larger than 5 MB' };
	}
	let workbook: Workbook;
	try {
		workbook = readWorkbook(input.bytes);
	} catch (error) {
		if (error instanceof SheetImportError) return { ok: false, status: 400, reason: error.message };
		throw error;
	}
	if (!workbook.sheets.some((s) => s.source)) {
		return { ok: false, status: 400, reason: 'The spreadsheet has no content to import' };
	}
	const created = await createWizardSession<WizardState, Workbook>(getDb(), actor, {
		namespaceId: input.namespaceId,
		fileName: input.fileName,
		workbook,
		state: startState(input.fileName)
	});
	return created.ok ? { ok: true, id: created.session.id } : failed(created);
}

export async function listImports(actor: Actor, namespaceId: string): Promise<ImportSummary[]> {
	const sessions = await listWizardSessions<WizardState>(getDb(), actor, namespaceId);
	return sessions.map((s) => ({
		id: s.id,
		fileName: s.fileName,
		updatedAt: s.updatedAt.toISOString(),
		processes: s.state.processes.length
	}));
}

/**
 * The import as the page shows it, with the pending proposal on the open process (`openSlug`)
 * checked against its draft as it is now. Undefined when the import is not the actor's.
 */
export async function loadWizard(
	actor: Actor,
	id: string,
	openSlug: string | undefined
): Promise<WizardView | undefined> {
	const loaded = await loadWizardSession<WizardState, Workbook>(getDb(), actor, id);
	if (!loaded.ok) return undefined;
	const { session } = loaded;
	const { state } = session;
	const ranges: Record<string, string[]> = {};
	for (const p of state.split?.processes ?? []) ranges[p.key] = p.sources.map(describeRange);
	state.split?.shared.forEach((s, i) => (ranges[`shared:${i}`] = s.sources.map(describeRange)));
	for (const p of state.processes) ranges[p.key] = p.sources.map(describeRange);
	const open = state.processes.find((p) => p.slug === openSlug);
	const turn = open && pendingTurn(state, open.key);
	return {
		id: session.id,
		version: session.version,
		fileName: session.fileName,
		namespaceId: session.namespaceId,
		model: safeModelName(),
		state,
		ranges,
		timeoutSeconds: turnTimeoutSeconds(),
		...(progressOf(id, actor.id) ? { progress: progressOf(id, actor.id)! } : {}),
		...(open && turn
			? { preview: await preview(actor, open.definitionId, open.key, turn.id, turn.ops) }
			: {})
	};
}

function safeModelName(): string {
	try {
		return modelName();
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
}

async function preview(
	actor: Actor,
	definitionId: string,
	processKey: string,
	turnId: string,
	ops: WizardState['turns'][number]['ops']
): Promise<ProposalPreview> {
	const db = getDb();
	const head = await storeDrafts(db, actor).head(definitionId);
	if (!head.ok) return { ok: false, processKey, turnId, reason: head.reason };
	const result = await previewDefinitionEdit(db, actor, {
		definitionId,
		ops,
		baseRevision: head.revision
	});
	if (!result.ok) {
		return {
			ok: false,
			processKey,
			turnId,
			reason: `This proposal no longer fits the draft: ${result.reason}`
		};
	}
	return {
		ok: true,
		processKey,
		turnId,
		revision: result.revision,
		document: result.document,
		changes: result.changes.map(describeChange),
		marks: marks(result.changes, result.document),
		blocking: result.warnings.filter((w) => w.severity === 'error').map((w) => w.message)
	};
}

function describeChange(c: Change): ProposalChange {
	switch (c.type) {
		case 'node-added':
			return { kind: 'added', summary: c.summary, nodeId: c.nodeId };
		case 'node-removed':
			return { kind: 'removed', summary: c.summary, nodeId: c.nodeId };
		case 'node-changed':
			return { kind: 'changed', summary: c.summary, nodeId: c.nodeId };
		case 'stages-reordered':
			return { kind: 'reordered', summary: c.summary };
		case 'document-changed':
			return { kind: 'changed', summary: c.summary };
	}
}

/**
 * Board cards a proposal touches: steps and decisions it adds are new; those it changes, or whose
 * recorded facts it adds or changes, are changed.
 */
function marks(changes: Change[], document: DefinitionDocument): Record<string, 'new' | 'changed'> {
	const out: Record<string, 'new' | 'changed'> = {};
	const work = document.nodes.filter((n) => n.core.kind === 'step' || n.core.kind === 'decision');
	for (const c of changes) {
		if (c.type !== 'node-added' && c.type !== 'node-changed') continue;
		if (c.kind === 'step' || c.kind === 'decision') {
			out[c.nodeId] = c.type === 'node-added' ? 'new' : (out[c.nodeId] ?? 'changed');
		} else if (c.kind === 'fact') {
			for (const n of work) {
				const core = n.core as { collects?: { fact: string }[]; outcome?: string };
				const records =
					core.collects?.some((x) => x.fact === c.nodeId) || core.outcome === c.nodeId;
				if (records && !out[n.core.id]) out[n.core.id] = 'changed';
			}
		}
	}
	return out;
}

/**
 * Runs one request on an import as the actor and saves the new state over the version it read.
 * Expected refusals, including the agent being unreachable, come back as a reason to show.
 */
export async function act(
	actor: Actor,
	id: string,
	request: WizardAction,
	baseVersion: number
): Promise<Outcome<{ version: number; slug?: string }>> {
	const db = getDb();
	const loaded = await loadWizardSession<WizardState, Workbook>(db, actor, id);
	if (!loaded.ok) return failed(loaded);
	const { session } = loaded;
	if (session.version !== baseVersion) {
		return {
			ok: false,
			status: 409,
			reason: 'The import changed while you were working on it; reload to see the latest'
		};
	}
	if (isRunning(id)) {
		return {
			ok: false,
			status: 409,
			reason: 'The assistant is still working on this import; wait for it to finish'
		};
	}
	const drafts = storeDrafts(db, actor);
	const deps = { drafts, actor, namespaceId: session.namespaceId };
	let state: WizardState;
	try {
		if (AGENT_ACTIONS.has(request.action)) {
			const problem = await modelProblem();
			if (problem) return { ok: false, status: 503, reason: problem };
			state = await runTurn(id, actor.id, ({ signal, onProgress }) =>
				apply(session.state, request, {
					...deps,
					agent: () => ({
						model: createChatModel(),
						drafts,
						workbook: session.workbook,
						signal,
						onProgress,
						lenient: modelSpec().provider === 'ollama'
					})
				})
			);
		} else {
			state = await apply(session.state, request, {
				...deps,
				agent: () => {
					throw new WizardError('That request does not run the assistant');
				}
			});
		}
	} catch (error) {
		if (error instanceof WizardError) return { ok: false, status: 422, reason: error.message };
		if (error instanceof TurnTimeout) {
			const minutes = Math.round(turnTimeoutSeconds() / 60);
			return {
				ok: false,
				status: 504,
				reason: `The assistant (${modelName()}) did not finish within ${minutes} minutes, so it was stopped and nothing changed. Try again, ask for something smaller, or set a faster model in CASEBOOK_WIZARD_MODEL.`
			};
		}
		console.error('wizard', request.action, error);
		const message = error instanceof Error ? error.message : String(error);
		return {
			ok: false,
			status: 502,
			reason: `The assistant (${modelName()}) could not answer: ${message.slice(0, 300)}`
		};
	}
	const saved = await saveWizardSession(db, actor, { id, baseVersion, state });
	if (!saved.ok) return failed(saved);
	const active = state.processes.find((p) => p.key === state.activeKey);
	return { ok: true, version: saved.version, ...(active ? { slug: active.slug } : {}) };
}

interface Deps {
	agent: () => Parameters<typeof wizard.reply>[0];
	drafts: ReturnType<typeof storeDrafts>;
	actor: Actor;
	namespaceId: string;
}

async function apply(state: WizardState, r: WizardAction, deps: Deps): Promise<WizardState> {
	switch (r.action) {
		case 'split':
			return wizard.proposeSplit(deps.agent(), state);
		case 'reply': {
			const next =
				r.processKey && state.phase === 'draft'
					? { ...state, activeKey: processOf(state, r.processKey).key }
					: state;
			return wizard.reply(deps.agent(), next, String(r.text ?? ''));
		}
		case 'rename':
			return renameProcess(state, r.key, String(r.title ?? ''));
		case 'merge':
			return mergeProcesses(state, r.from, r.into);
		case 'split-off':
			return splitProcess(state, r.key, Number(r.index));
		case 'accept-split':
			return wizard.acceptSplit(deps.drafts, state, deps.namespaceId);
		case 'draft':
			return wizard.draft(deps.agent(), state, r.key);
		case 'accept':
			return wizard.acceptTurn(deps.drafts, state, r.turnId, Number(r.baseRevision));
		case 'reject':
			return wizard.rejectTurn(state, r.turnId);
		case 'publish': {
			const process = processOf(state, r.key);
			const result = await publishDefinition(getDb(), deps.actor, {
				definitionId: process.definitionId,
				baseRevision: Number(r.baseRevision)
			});
			return wizard.recordPublish(
				{ ...state, activeKey: process.key },
				process.key,
				result.ok
					? { ok: true, version: result.version }
					: {
							ok: false,
							reason: result.reason,
							problems: [
								...result.errors,
								...result.issues.filter((i) => i.severity === 'error')
							].map((p) => p.message)
						}
			);
		}
		default:
			throw new WizardError('Unknown request');
	}
}
