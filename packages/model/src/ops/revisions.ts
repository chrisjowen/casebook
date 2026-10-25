import { checkInvariants, type InvariantIssue } from '../invariants.js';
import type { DefinitionDocument } from '../node.js';
import { applyBatch, checkDraft } from './apply.js';
import { reject, type Rejection } from './rejection.js';
import { diff } from './diff.js';
import type { Operation } from './operations.js';

/**
 * Draft revision history (ADR 0002): every accepted edit is a new numbered revision recording the
 * operations, who made them and on whose behalf (ADR 0009). Undo is a new revision that restores
 * an earlier document, so history only grows.
 */

export const PRINCIPAL_KINDS = ['user', 'group', 'agent', 'service'] as const;

export type PrincipalKind = (typeof PRINCIPAL_KINDS)[number];

export interface PrincipalRef {
	id: string;
	kind: PrincipalKind;
}

/**
 * Who made an edit. A user acts for themselves; an agent or service acts on behalf of a user,
 * group or service principal, never another agent (ADR 0009).
 */
export interface Attribution {
	author: PrincipalRef;
	onBehalfOf?: PrincipalRef;
}

export interface Revision {
	/** Starts at 1 and increases by one per revision of the same draft. */
	number: number;
	document: DefinitionDocument;
	/** The operations that produced this revision from the one before; empty for the first. */
	ops: Operation[];
	author: PrincipalRef;
	onBehalfOf?: PrincipalRef;
	/** ISO 8601 timestamp. */
	createdAt: string;
	/** Set when this revision restores the document of an earlier one, as undo does. */
	revertedTo?: number;
}

export interface Committed {
	ok: true;
	revision: Revision;
	/** Invariant issues in the new revision's document; see `Applied.warnings`. */
	warnings: InvariantIssue[];
}

export type CommitResult = Committed | Rejection;

/** Explains why an attribution is not allowed, or returns undefined when it is. */
export function attributionProblem({ author, onBehalfOf }: Attribution): string | undefined {
	switch (author.kind) {
		case 'user':
			return onBehalfOf === undefined
				? undefined
				: 'a user edits on their own behalf, so onBehalfOf must not be set';
		case 'agent':
		case 'service':
			if (onBehalfOf === undefined) {
				return `an ${author.kind} must record who it acts on behalf of`;
			}
			return onBehalfOf.kind === 'agent'
				? 'an agent cannot act on behalf of another agent'
				: undefined;
		case 'group':
			return 'a group cannot author an edit; record the user or agent who made it';
	}
}

/**
 * Starts a draft's history with `document` as revision 1. The document is checked as if added in
 * one edit: it must pass the schema and have no rejecting invariant issue.
 */
export function startHistory(
	document: DefinitionDocument,
	attribution: Attribution,
	at: Date = new Date()
): CommitResult {
	const invalid = checkAttribution(attribution);
	if (invalid !== undefined) return invalid;
	const checked = checkDraft(document);
	if (!checked.ok) return checked;
	return committed({ number: 1, document, ops: [], ...attribution, createdAt: at.toISOString() });
}

/**
 * Applies an edit to the head revision as one atomic batch and returns the next revision. An edit
 * that leaves the document unchanged is rejected, so every revision records a real change.
 */
export function commit(
	head: Revision,
	ops: readonly Operation[],
	attribution: Attribution,
	at: Date = new Date()
): CommitResult {
	const invalid = checkAttribution(attribution);
	if (invalid !== undefined) return invalid;
	const result = applyBatch(head.document, ops);
	if (!result.ok) return result;
	if (diff(head.document, result.document).length === 0) {
		return reject('no-change', 'The edit changes nothing in the draft');
	}
	return {
		ok: true,
		revision: {
			number: head.number + 1,
			document: result.document,
			ops: [...ops],
			...attribution,
			createdAt: at.toISOString()
		},
		warnings: result.warnings
	};
}

/** Restores the document of revision `to` as a new revision at the head of `history`. */
export function revert(
	history: readonly Revision[],
	to: number,
	attribution: Attribution,
	at: Date = new Date()
): CommitResult {
	const invalid = checkAttribution(attribution);
	if (invalid !== undefined) return invalid;
	const head = history.at(-1);
	const target = history.find((r) => r.number === to);
	if (head === undefined || target === undefined) {
		return reject('unknown-revision', `There is no revision ${to} in this draft's history`);
	}
	if (diff(head.document, target.document).length === 0) {
		return reject('no-change', `The draft already matches revision ${to}`);
	}
	return committed({
		number: head.number + 1,
		document: target.document,
		ops: [],
		...attribution,
		createdAt: at.toISOString(),
		revertedTo: to
	});
}

/**
 * Undoes the latest edit by restoring the revision before it. Undoing again keeps stepping back:
 * a revision that was itself a revert counts as the revision it restored.
 */
export function undo(
	history: readonly Revision[],
	attribution: Attribution,
	at: Date = new Date()
): CommitResult {
	const head = history.at(-1);
	const current = head?.revertedTo ?? head?.number ?? 0;
	if (current <= 1) return reject('nothing-to-undo', 'There is no earlier revision to go back to');
	return revert(history, current - 1, attribution, at);
}

function checkAttribution(attribution: Attribution): Rejection | undefined {
	const problem = attributionProblem(attribution);
	return problem === undefined
		? undefined
		: reject('invalid-attribution', `Cannot record this edit: ${problem}`);
}

function committed(revision: Revision): Committed {
	return { ok: true, revision, warnings: checkInvariants(revision.document) };
}
