import type { InvariantIssue } from '../invariants.js';
import type { ValidationError } from '../validate.js';

export const REJECTION_CODES = [
	'invalid-operation',
	'unknown-node',
	'wrong-kind',
	'duplicate-id',
	'immutable-field',
	'referenced',
	'no-change',
	'not-linked',
	'required-edge',
	'schema-violation',
	'broken-reference',
	'process-count',
	'invalid-attribution',
	'unknown-revision',
	'nothing-to-undo'
] as const;

export type RejectionCode = (typeof REJECTION_CODES)[number];

/** Why an edit was refused. The document it was tried on is unchanged. */
export interface Rejection {
	ok: false;
	code: RejectionCode;
	/** Plain-language explanation, naming the nodes and fields at fault. */
	reason: string;
	/** The operation refused, when the rejection is about one. */
	operation?: unknown;
	/** Position of that operation in a batch. */
	index?: number;
	/** Schema violations the operation would have caused. */
	errors: ValidationError[];
	/** Invariant issues the operation would have introduced. */
	issues: InvariantIssue[];
}

/** Builds a rejection with no schema errors or invariant issues attached. */
export function reject(code: RejectionCode, reason: string): Rejection {
	return { ok: false, code, reason, errors: [], issues: [] };
}
