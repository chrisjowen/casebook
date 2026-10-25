import { checkPublish, type InvariantIssue } from '../invariants.js';
import type { DefinitionDocument } from '../node.js';
import type { ValidationError } from '../validate.js';
import { diff } from './diff.js';
import { clone, deepFreeze } from './json.js';
import type { PrincipalRef } from './revisions.js';

/**
 * How a definition changes over time, and so how publishing works.
 *
 * - `governed`, for fixed processes such as incident management: edits build up in the draft and
 *   an explicit publish makes the next numbered version. Publishing refuses while any publish
 *   check fails and, when `requiresApproval` is set, until someone has approved it.
 * - `living`, for one-off processes that change as they run, such as a hospital stay: every
 *   accepted edit publishes a new version straight away. Publish-check failures are recorded on
 *   the version as warnings rather than refusing it.
 */
export type ChangePolicy = { mode: 'governed'; requiresApproval?: boolean } | { mode: 'living' };

export const CHANGE_POLICY_MODES = ['governed', 'living'] as const;

export type ChangePolicyMode = (typeof CHANGE_POLICY_MODES)[number];

/** Whether a case stays on the version it started with, or moves to each new version. */
export type CaseVersionBinding = 'pinned' | 'follow-latest';

/**
 * The version binding a new case gets by default: pinned for governed definitions, following the
 * latest version for living ones. Moving a pinned case to a newer version is an explicit, recorded
 * action of the case runtime.
 */
export function defaultCaseBinding(policy: ChangePolicy): CaseVersionBinding {
	return policy.mode === 'governed' ? 'pinned' : 'follow-latest';
}

/** True when every accepted edit publishes a new version on its own. */
export function publishesOnEdit(policy: ChangePolicy): boolean {
	return policy.mode === 'living';
}

/** An immutable, numbered version of a definition, with what was known when it was published. */
export interface PublishedVersion {
	version: number;
	/** Deep-frozen; its `version` field matches `version`. */
	document: DefinitionDocument;
	policy: ChangePolicyMode;
	/** The draft revision the version was made from, when there is one. */
	revision?: number;
	publishedBy: PrincipalRef;
	onBehalfOf?: PrincipalRef;
	approvedBy?: PrincipalRef;
	/** ISO 8601 timestamp. */
	publishedAt: string;
	/**
	 * Invariant issues at publish time. Under `governed` these are warnings only; under `living`
	 * they can include errors that were recorded instead of refusing the version.
	 */
	issues: InvariantIssue[];
}

export interface PublishRequest {
	policy: ChangePolicy;
	document: DefinitionDocument;
	/** The latest published version, if any; the new one is numbered after it. */
	latest?: PublishedVersion;
	revision?: number;
	publishedBy: PrincipalRef;
	onBehalfOf?: PrincipalRef;
	/** Required by a governed policy with `requiresApproval`. */
	approvedBy?: PrincipalRef;
	at?: Date;
}

export const PUBLISH_REFUSAL_CODES = [
	'schema-violation',
	'checks-failed',
	'approval-required',
	'no-change'
] as const;

export type PublishRefusalCode = (typeof PUBLISH_REFUSAL_CODES)[number];

export type PublishDecision =
	| { allowed: true; version: PublishedVersion }
	| {
			allowed: false;
			code: PublishRefusalCode;
			reason: string;
			errors: ValidationError[];
			issues: InvariantIssue[];
	  };

/**
 * Decides whether `document` can be published under `policy` and, if so, builds the version to
 * record. A schema-invalid document is never published, under either policy; documents edited
 * through operations are always schema-valid, so a living definition can always publish them.
 */
export function publish(request: PublishRequest): PublishDecision {
	const { policy, document, latest } = request;
	const check = checkPublish(document);
	if (check.errors.length > 0) {
		return refuse(
			'schema-violation',
			`The definition does not match the schema: ${check.errors.map((e) => e.message).join('; ')}`,
			check.errors
		);
	}
	const errors = check.issues.filter((i) => i.severity === 'error');
	if (policy.mode === 'governed' && errors.length > 0) {
		return refuse(
			'checks-failed',
			`Fix these before publishing: ${errors.map((i) => i.message).join('; ')}`,
			[],
			errors
		);
	}
	if (
		policy.mode === 'governed' &&
		policy.requiresApproval === true &&
		request.approvedBy === undefined
	) {
		return refuse(
			'approval-required',
			'This definition needs an approval before it can be published'
		);
	}
	const version = (latest?.version ?? 0) + 1;
	const body = { ...document, version };
	if (latest !== undefined && diff({ ...latest.document, version }, body).length === 0) {
		return refuse('no-change', `Nothing has changed since version ${latest.version}`);
	}
	return {
		allowed: true,
		version: deepFreeze(
			clone({
				version,
				document: body,
				policy: policy.mode,
				...(request.revision === undefined ? {} : { revision: request.revision }),
				publishedBy: request.publishedBy,
				...(request.onBehalfOf === undefined ? {} : { onBehalfOf: request.onBehalfOf }),
				...(request.approvedBy === undefined ? {} : { approvedBy: request.approvedBy }),
				publishedAt: (request.at ?? new Date()).toISOString(),
				issues: check.issues
			})
		)
	};
}

function refuse(
	code: PublishRefusalCode,
	reason: string,
	errors: ValidationError[] = [],
	issues: InvariantIssue[] = []
): PublishDecision {
	return { allowed: false, code, reason, errors, issues };
}
