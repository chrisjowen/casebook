import type { DefinitionDocument } from '../node.js';
import { reject, type Rejection } from './rejection.js';
import type { Operation } from './operations.js';
import {
	publish,
	publishesOnEdit,
	type ChangePolicy,
	type PublishDecision,
	type PublishedVersion,
	type PublishRefusal
} from './publish.js';
import {
	commit,
	revert,
	startHistory,
	undo,
	type Attribution,
	type CommitResult,
	type Committed,
	type PrincipalRef,
	type Revision
} from './revisions.js';
import { NumberingConflictError, type RevisionStore } from './store.js';

/**
 * Editing a stored draft: load the head revision, apply the edit, store the new revision and,
 * under a living policy, publish it. Persistence is whatever `RevisionStore` the caller passes.
 */

export interface DraftContext {
	store: RevisionStore;
	definitionId: string;
	policy: ChangePolicy;
}

/**
 * A stored revision. Under a living policy it also carries one of: the version it published; the
 * newer version that already holds it, when a later edit published first; or, when publishing was
 * refused after the revision was stored, why.
 */
export type DraftResult =
	| (Committed & {
			published?: PublishedVersion;
			supersededBy?: PublishedVersion;
			publishRefused?: PublishRefusal;
	  })
	| Rejection;

const LIVING_PUBLISH_ATTEMPTS = 3;

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
	const { store, definitionId } = context;
	const head = await store.head(definitionId);
	if (head === undefined) return noDraft(context);
	return publishRevision(context, head, await store.latestVersion(definitionId), options);
}

async function publishRevision(
	{ store, definitionId, policy }: DraftContext,
	revision: Revision,
	latest: PublishedVersion | undefined,
	options: PublishDraftOptions
): Promise<PublishDecision> {
	const decision = publish({
		...options,
		policy,
		document: revision.document,
		revision: revision.number,
		...(latest === undefined ? {} : { latest })
	});
	if (!decision.allowed) return decision;
	try {
		await store.appendVersion(definitionId, decision.version);
	} catch (error) {
		if (!(error instanceof NumberingConflictError)) throw error;
		return {
			allowed: false,
			code: 'version-conflict',
			reason: `Version ${decision.version.version} was published by someone else at the same time; publish again to make the next one`,
			errors: [],
			issues: []
		};
	}
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
	const options = { publishedBy: author, ...(onBehalfOf === undefined ? {} : { onBehalfOf }), at };
	for (let attempt = 1; ; attempt++) {
		const latest = await context.store.latestVersion(context.definitionId);
		const decision = await publishRevision(context, result.revision, latest, options);
		if (decision.allowed) return { ...result, published: decision.version };
		if (decision.code === 'superseded' && latest !== undefined) {
			return { ...result, supersededBy: latest };
		}
		if (decision.code !== 'version-conflict' || attempt === LIVING_PUBLISH_ATTEMPTS) {
			return { ...result, publishRefused: decision };
		}
	}
}

function noDraft({ definitionId }: DraftContext): Rejection {
	return reject('unknown-revision', `${definitionId} has no draft yet; create one first`);
}
