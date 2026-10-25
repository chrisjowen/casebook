import type { DefinitionDocument } from '../node.js';
import { reject, type Rejection } from './rejection.js';
import type { Operation } from './operations.js';
import {
	publish,
	publishesOnEdit,
	type ChangePolicy,
	type PublishDecision,
	type PublishedVersion
} from './publish.js';
import {
	commit,
	revert,
	startHistory,
	undo,
	type Attribution,
	type CommitResult,
	type Committed,
	type PrincipalRef
} from './revisions.js';
import type { RevisionStore } from './store.js';

/**
 * Editing a stored draft: load the head revision, apply the edit, store the new revision and,
 * under a living policy, publish it. Persistence is whatever `RevisionStore` the caller passes.
 */

export interface DraftContext {
	store: RevisionStore;
	definitionId: string;
	policy: ChangePolicy;
}

/** A stored revision, plus the version it published under a living policy. */
export type DraftResult = (Committed & { published?: PublishedVersion }) | Rejection;

/** Stores `document` as revision 1 of a new draft. */
export function createDraft(
	context: DraftContext,
	document: DefinitionDocument,
	attribution: Attribution,
	at: Date = new Date()
): Promise<DraftResult> {
	return save(context, startHistory(document, attribution, at), attribution, at);
}

/** Applies operations to the draft's head as one atomic edit. */
export async function editDraft(
	context: DraftContext,
	ops: readonly Operation[],
	attribution: Attribution,
	at: Date = new Date()
): Promise<DraftResult> {
	const head = await context.store.head(context.definitionId);
	if (head === undefined) return noDraft(context);
	return save(context, commit(head, ops, attribution, at), attribution, at);
}

/** Undoes the draft's latest edit. */
export async function undoDraft(
	context: DraftContext,
	attribution: Attribution,
	at: Date = new Date()
): Promise<DraftResult> {
	const history = await context.store.revisions(context.definitionId);
	return save(context, undo(history, attribution, at), attribution, at);
}

/** Restores revision `to` of the draft as a new revision. */
export async function revertDraft(
	context: DraftContext,
	to: number,
	attribution: Attribution,
	at: Date = new Date()
): Promise<DraftResult> {
	const history = await context.store.revisions(context.definitionId);
	return save(context, revert(history, to, attribution, at), attribution, at);
}

export interface PublishDraftOptions {
	publishedBy: PrincipalRef;
	onBehalfOf?: PrincipalRef;
	approvedBy?: PrincipalRef;
	at?: Date;
}

/** Publishes the draft's head as the next version, if the policy allows it, and stores it. */
export async function publishDraft(
	context: DraftContext,
	options: PublishDraftOptions
): Promise<PublishDecision | Rejection> {
	const { store, definitionId, policy } = context;
	const head = await store.head(definitionId);
	if (head === undefined) return noDraft(context);
	const latest = await store.latestVersion(definitionId);
	const decision = publish({
		...options,
		policy,
		document: head.document,
		revision: head.number,
		...(latest === undefined ? {} : { latest })
	});
	if (decision.allowed) await store.appendVersion(definitionId, decision.version);
	return decision;
}

async function save(
	context: DraftContext,
	result: CommitResult,
	{ author, onBehalfOf }: Attribution,
	at: Date
): Promise<DraftResult> {
	if (!result.ok) return result;
	await context.store.appendRevision(context.definitionId, result.revision);
	if (!publishesOnEdit(context.policy)) return result;
	const decision = await publishDraft(context, {
		publishedBy: author,
		...(onBehalfOf === undefined ? {} : { onBehalfOf }),
		at
	});
	return 'allowed' in decision && decision.allowed
		? { ...result, published: decision.version }
		: result;
}

function noDraft({ definitionId }: DraftContext): Rejection {
	return reject('unknown-revision', `${definitionId} has no draft yet; create one first`);
}
