import type { PrincipalRef } from '../ops/revisions.js';

/** An approval of work on a case, as `workApprovalProblem` checks it. */
export interface WorkApproval {
	approver: PrincipalRef;
	/** Set when the approver claims to act for someone else, which an approval never allows. */
	approverOnBehalfOf?: Pick<PrincipalRef, 'id'>;
	/** Who completed the step under review. */
	doneBy: Pick<PrincipalRef, 'id'>;
	/** Who they completed it on behalf of, when an agent or service did it. */
	doneOnBehalfOf?: Pick<PrincipalRef, 'id'>;
}

/**
 * Explains why an approval of a step is not allowed, or returns undefined when its people are
 * right. Approvals are human-only (ADR 0009, ADR 0017): the approver is a user acting for
 * themselves, and is neither who did the reviewed step nor who it was done for. Whether the
 * approver holds the approval's role is for the permission check to answer.
 */
export function workApprovalProblem(approval: WorkApproval): string | undefined {
	const { approver, approverOnBehalfOf, doneBy, doneOnBehalfOf } = approval;
	if (approver.kind !== 'user') {
		return `approvals are human-only, so a ${approver.kind} cannot approve`;
	}
	if (approverOnBehalfOf !== undefined && approverOnBehalfOf.id !== approver.id) {
		return 'an approver approves for themselves, never on behalf of someone else';
	}
	if (approver.id === doneBy.id || approver.id === doneOnBehalfOf?.id) {
		return 'nobody approves their own work, and you did the step under review';
	}
	return undefined;
}
