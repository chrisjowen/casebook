// Permission resolution (ADR 0017): the "can this principal do this?" check. It resolves the
// account roles and namespace permissions of ADR 0015, the case bindings of ADR 0008 and the
// delegation grants of ADR 0009, and explains every decision in plain language. `can` reads the
// store tables directly, so a repository write runs it inside its own transaction.
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Queryable } from './client.js';
import {
	accounts,
	cases,
	delegationGrants,
	groupMembers,
	namespaces,
	principals,
	processDefinitions,
	roleBindings
} from './schema.js';

type PrincipalKind = (typeof principals.$inferSelect)['kind'];

/** Built-in account-level roles, bound at account scope (ADR 0015). */
export const ACCOUNT_ROLES = ['account-owner', 'account-admin', 'developer', 'read-only'] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

/** Built-in namespace-level permissions, bound at namespace scope and inherited by descendants. */
export const NAMESPACE_PERMISSIONS = ['namespace-admin', 'write', 'read'] as const;
export type NamespacePermission = (typeof NAMESPACE_PERMISSIONS)[number];

export const isAccountRole = (role: string): role is AccountRole =>
	(ACCOUNT_ROLES as readonly string[]).includes(role);
export const isNamespacePermission = (role: string): role is NamespacePermission =>
	(NAMESPACE_PERMISSIONS as readonly string[]).includes(role);

/** Every prefix of a namespace path, nearest first: `a/b/c` gives `a/b/c`, `a/b`, `a`. */
export function namespacePathPrefixes(path: string): string[] {
	const segments = path.split('/');
	return segments.map((_, i) => segments.slice(0, segments.length - i).join('/'));
}

/** What a principal can be asked permission for. New actions get an entry in `RULES`. */
export const ACTIONS = [
	'account.manage_members',
	'namespace.create',
	'namespace.manage',
	'namespace.manage_permissions',
	'definition.create',
	'definition.read',
	'definition.edit',
	'definition.publish',
	'definition.approve',
	'definition.retire',
	'case.bind_version',
	'case.act_in_role'
] as const;
export type Action = (typeof ACTIONS)[number];

/**
 * What an action applies to. `namespace.create` takes the account (for a top-level namespace) or
 * the parent namespace. `definition.approve` takes the publish being approved, so the approver can
 * be checked against who publishes it. `case.act_in_role` asks whether a principal fills a process
 * role on a case.
 */
export type Resource =
	| { type: 'account'; accountId: string }
	| { type: 'namespace'; namespaceId: string }
	| { type: 'definition'; definitionId: string }
	| { type: 'publication'; definitionId: string; publishedById: string; onBehalfOfId?: string }
	| { type: 'case'; caseId: string }
	| { type: 'case-role'; caseId: string; role: string };
export type ResourceType = Resource['type'];

/**
 * Who is asking. An agent acts on behalf of the user it signed in as, or as its owning service's
 * unattended agent; a service may act on behalf of another principal; a user acts only for
 * themselves (ADR 0009, ADR 0017).
 */
export interface Actor {
	id: string;
	onBehalfOfId?: string;
}

/** The answer to a permission check, with a plain-language explanation either way. */
export interface Decision {
	allowed: boolean;
	reason: string;
}

export interface CanOptions {
	/** The time delegation expiry is checked against; defaults to now. */
	now?: Date;
}

/** A resolved resource: its account and the namespace lineage its permissions inherit along. */
interface Target {
	type: ResourceType;
	label: string;
	accountId: string;
	accountSlug: string;
	/** The resource's namespace and its ancestors, nearest first; empty for an account. */
	lineage: { id: string; path: string }[];
	caseId?: string;
	role?: string;
}

interface ActionRule {
	resources: readonly ResourceType[];
	verb: (target: Target) => string;
	/** Account roles that allow the action by themselves. */
	accountRoles?: readonly AccountRole[];
	/**
	 * The least namespace permission that allows the action, held on the resource's namespace or an
	 * ancestor, or implied by an account role.
	 */
	permission?: NamespacePermission;
	/** Allowed by holding the target's process role on the case, or as a standing role. */
	processRole?: true;
}

const RULES: { readonly [A in Action]: ActionRule } = {
	'account.manage_members': {
		resources: ['account'],
		verb: () => 'manage the members of',
		accountRoles: ['account-owner', 'account-admin']
	},
	'namespace.create': {
		resources: ['account', 'namespace'],
		verb: (t) => (t.type === 'namespace' ? 'create a namespace under' : 'create a namespace in'),
		accountRoles: ['account-owner', 'account-admin', 'developer'],
		permission: 'namespace-admin'
	},
	'namespace.manage': {
		resources: ['namespace'],
		verb: () => 'manage',
		permission: 'namespace-admin'
	},
	'namespace.manage_permissions': {
		resources: ['namespace'],
		verb: () => 'manage permissions on',
		permission: 'namespace-admin'
	},
	'definition.create': {
		resources: ['namespace'],
		verb: () => 'create definitions in',
		permission: 'write'
	},
	'definition.read': {
		resources: ['namespace', 'definition'],
		verb: (t) => (t.type === 'namespace' ? 'read definitions in' : 'read'),
		permission: 'read'
	},
	'definition.edit': {
		resources: ['definition'],
		verb: () => 'edit the draft of',
		permission: 'write'
	},
	'definition.publish': {
		resources: ['definition'],
		verb: () => 'publish',
		permission: 'write'
	},
	'definition.approve': {
		resources: ['publication'],
		verb: () => 'approve publishing',
		permission: 'write'
	},
	'definition.retire': {
		resources: ['definition'],
		verb: () => 'retire versions of',
		permission: 'namespace-admin'
	},
	'case.bind_version': {
		resources: ['case'],
		verb: () => 'move the bound version of',
		permission: 'write'
	},
	'case.act_in_role': {
		resources: ['case-role'],
		verb: (t) => `act as ${t.role} on`,
		processRole: true
	}
};

const LEVEL: Record<NamespacePermission, number> = { read: 1, write: 2, 'namespace-admin': 3 };

/**
 * The namespace permission each account role implies on every namespace in its account. Owners
 * and admins are namespace-admin everywhere (ADR 0015); developers and read-only members can read.
 * A developer is namespace-admin only of the namespaces they create, through the binding made then.
 */
const IMPLIED: Record<AccountRole, NamespacePermission> = {
	'account-owner': 'namespace-admin',
	'account-admin': 'namespace-admin',
	developer: 'read',
	'read-only': 'read'
};

/** A role binding the principal holds that bears on the target, directly or through a group. */
interface Held {
	role: string;
	namespaceId: string | null;
	caseId: string | null;
	/** The group the binding is held through, when it is not held directly. */
	via: string | null;
}

interface PrincipalRow {
	id: string;
	kind: PrincipalKind;
	displayName: string;
	ownerId: string | null;
}

/**
 * Decides whether `actor` may perform `action` on `resource`, and explains why.
 *
 * Account roles are checked first, then namespace permissions on the resource's namespace and its
 * ancestors, then case bindings for case resources. Bindings held through groups count, including
 * nested groups. Bindings never apply outside their account. An agent needs an active delegation
 * grant from the user it acts for that covers the resource, and gets only what both the grant
 * and that user allow; an unattended agent acting for its owning service gets the service's
 * authority. `definition.approve` is for human users only, and never the publisher or the
 * principal the publish is made on behalf of.
 */
export async function can(
	db: Queryable,
	actor: Actor,
	action: Action,
	resource: Resource,
	options: CanOptions = {}
): Promise<Decision> {
	const rule = RULES[action];
	if (!rule.resources.includes(resource.type)) {
		return refuse(`${action} applies to ${orList([...rule.resources])}, not to ${resource.type}`);
	}
	const target = await resolveTarget(db, resource);
	if (typeof target === 'string') return refuse(target);

	const who = await principalById(db, actor.id);
	if (!who) return refuse(`principal ${actor.id} does not exist`);
	const forId =
		actor.onBehalfOfId !== undefined && actor.onBehalfOfId !== actor.id
			? actor.onBehalfOfId
			: undefined;
	const represented = forId === undefined ? undefined : await principalById(db, forId);
	if (forId !== undefined && !represented) return refuse(`principal ${forId} does not exist`);

	if (resource.type === 'publication') {
		const problem = approvalProblem({
			approver: who,
			...(represented ? { approverOnBehalfOf: represented } : {}),
			publishedBy: { id: resource.publishedById },
			...(resource.onBehalfOfId === undefined ? {} : { onBehalfOf: { id: resource.onBehalfOfId } })
		});
		if (problem) return refuse(`${nameOf(who)} cannot approve ${target.label}: ${problem}`);
	}

	const authority = (p: PrincipalRow) => authorityOf(db, p, rule, target);
	switch (who.kind) {
		case 'group':
			return refuse(`${nameOf(who)} cannot act itself; one of its members acts`);
		case 'user':
			if (represented) {
				return refuse(
					`${nameOf(who)} acts only for themselves, not on behalf of ${nameOf(represented)}`
				);
			}
			return authority(who);
		case 'service': {
			if (represented?.kind === 'agent') return refuse(nobodyActsForAgents(who, represented));
			const own = await authority(who);
			if (!own.allowed || !represented) return own;
			const theirs = await authority(represented);
			return {
				allowed: theirs.allowed,
				reason: `${own.reason}, acting on behalf of ${nameOf(represented)}, ${theirs.allowed ? 'and' : 'but'} ${theirs.reason}`
			};
		}
		case 'agent':
			return agentDecision(db, who, represented, rule, target, options.now ?? new Date());
	}
}

/** A principal and its kind, shaped like the references node operations record. */
export interface PrincipalRef {
	id: string;
	kind: PrincipalKind;
}

/** A principal reference where only the id matters. */
type PrincipalId = Pick<PrincipalRef, 'id'> & Partial<PrincipalRef>;

/** An approval of a publish, as `approvalProblem` checks it. */
export interface Approval {
	approver: PrincipalRef;
	/** Set when the approver claims to act for someone else, which an approval never allows. */
	approverOnBehalfOf?: PrincipalId;
	publishedBy: PrincipalId;
	/** The principal the publish is made on behalf of, when an agent or service publishes. */
	onBehalfOf?: PrincipalId;
}

/**
 * Explains why an approval is not allowed, or returns undefined when its people are right. An
 * approval is human-only: the approver is a user acting for themselves, and is neither the
 * publisher nor the principal the publish is made on behalf of. This checks only who approves;
 * `can` with `definition.approve` also checks the approver's permission. Pure, so node operations
 * can apply the same rule.
 */
export function approvalProblem(approval: Approval): string | undefined {
	const { approver, approverOnBehalfOf, publishedBy, onBehalfOf } = approval;
	if (approver.kind !== 'user') {
		return `approvals are human-only, so a ${approver.kind} cannot approve`;
	}
	if (approverOnBehalfOf !== undefined && approverOnBehalfOf.id !== approver.id) {
		return 'an approver approves for themselves, never on behalf of another principal';
	}
	if (approver.id === publishedBy.id) return 'the publisher cannot approve their own publish';
	if (onBehalfOf !== undefined && approver.id === onBehalfOf.id) {
		return 'the principal the publish is made on behalf of cannot approve it';
	}
	return undefined;
}

async function agentDecision(
	db: Queryable,
	agent: PrincipalRow,
	represented: PrincipalRow | undefined,
	rule: ActionRule,
	target: Target,
	now: Date
): Promise<Decision> {
	if (!represented) {
		return refuse(
			`${nameOf(agent)} must act on behalf of a user or its owning service, and none was given`
		);
	}
	switch (represented.kind) {
		case 'agent':
			return refuse(nobodyActsForAgents(agent, represented));
		case 'group':
			return refuse(
				`${nameOf(agent)} cannot act for ${nameOf(represented)}: agents sign in as a user and act for that user, so acting for a group is not supported`
			);
		case 'service': {
			if (agent.ownerId !== represented.id) {
				return refuse(
					`${nameOf(agent)} is not owned by ${nameOf(represented)}, and an agent acts for a service only as that service's unattended agent`
				);
			}
			const theirs = await authorityOf(db, represented, rule, target);
			return {
				allowed: theirs.allowed,
				reason: `${nameOf(agent)} acts unattended for its owning ${nameOf(represented)}, ${theirs.allowed ? 'and' : 'but'} ${theirs.reason}`
			};
		}
		case 'user':
			break;
	}

	const grants = await db
		.select({
			id: delegationGrants.id,
			namespaceId: delegationGrants.namespaceId,
			namespacePath: namespaces.path,
			namespaceAccountId: namespaces.accountId,
			caseId: delegationGrants.caseId,
			role: delegationGrants.role,
			expiresAt: delegationGrants.expiresAt,
			revokedAt: delegationGrants.revokedAt
		})
		.from(delegationGrants)
		.leftJoin(namespaces, eq(namespaces.id, delegationGrants.namespaceId))
		.where(
			and(eq(delegationGrants.agentId, agent.id), eq(delegationGrants.delegatorId, represented.id))
		)
		.orderBy(desc(delegationGrants.createdAt));
	const active = grants.filter((g) => g.revokedAt === null && g.expiresAt > now);
	const [latest] = grants;
	if (!latest) {
		return refuse(`${nameOf(represented)} has not granted ${nameOf(agent)} a delegation`);
	}
	if (active.length === 0) {
		const state =
			latest.revokedAt !== null
				? `was revoked at ${latest.revokedAt.toISOString()}`
				: `expired at ${latest.expiresAt.toISOString()}`;
		return refuse(
			`${nameOf(agent)} has no active delegation from ${nameOf(represented)}: the latest grant ${state}`
		);
	}

	const problems: string[] = [];
	for (const grant of active) {
		const problem = grantProblem(grant, rule, target);
		if (problem !== undefined) {
			problems.push(`grant ${grant.id} ${problem}`);
			continue;
		}
		const theirs = await authorityOf(db, represented, rule, target);
		return {
			allowed: theirs.allowed,
			reason: `${nameOf(agent)} acts for ${nameOf(represented)} under delegation grant ${grant.id} (${grantLimits(grant)}), ${theirs.allowed ? 'and' : 'but'} ${theirs.reason}`
		};
	}
	return refuse(
		`no active delegation from ${nameOf(represented)} to ${nameOf(agent)} covers ${target.label}: ${problems.join('; ')}`
	);
}

interface GrantLimits {
	namespaceId: string | null;
	namespacePath: string | null;
	namespaceAccountId: string | null;
	caseId: string | null;
	role: string | null;
	expiresAt: Date;
}

/** Why a grant's namespace, case and role limits do not cover the target, if they don't. */
function grantProblem(grant: GrantLimits, rule: ActionRule, target: Target): string | undefined {
	const nearest = target.lineage[0];
	if (grant.namespaceId !== null) {
		const path = grant.namespacePath!;
		if (grant.namespaceAccountId !== target.accountId) {
			return `is limited to namespace ${path} in another account`;
		}
		if (!nearest || (nearest.path !== path && !nearest.path.startsWith(`${path}/`))) {
			return `is limited to namespace ${path}`;
		}
	}
	if (grant.caseId !== null && grant.caseId !== target.caseId) {
		return 'is limited to another case';
	}
	if (grant.role !== null) {
		// The grant caps the agent at what the role itself would allow here.
		const role = grant.role;
		const capped: Held | undefined = isAccountRole(role)
			? { role, namespaceId: null, caseId: null, via: null }
			: !nearest
				? undefined
				: {
						role,
						namespaceId: nearest.id,
						caseId: isNamespacePermission(role) ? null : (target.caseId ?? null),
						via: null
					};
		if (!capped || !evaluate(rule, target, 'the grant', [capped], false).allowed) {
			return `is limited to the role ${role}, which does not allow this`;
		}
	}
	return undefined;
}

function grantLimits(grant: GrantLimits): string {
	return [
		grant.namespacePath === null ? 'any namespace' : `limited to ${grant.namespacePath}`,
		...(grant.caseId === null ? [] : ['one case']),
		...(grant.role === null ? [] : [`role ${grant.role}`]),
		`until ${grant.expiresAt.toISOString()}`
	].join(', ');
}

/** The principal's own authority over the target, from the bindings it holds there. */
async function authorityOf(
	db: Queryable,
	principal: PrincipalRow,
	rule: ActionRule,
	target: Target
): Promise<Decision> {
	const held = await heldBindings(db, principal.id, target);
	const elsewhere = held.length === 0 && (await holdsRolesElsewhere(db, principal.id, target));
	return evaluate(rule, target, nameOf(principal), held, elsewhere);
}

/** Resolves account roles, then inherited namespace permissions, then case bindings. */
function evaluate(
	rule: ActionRule,
	target: Target,
	subject: string,
	held: Held[],
	elsewhere: boolean
): Decision {
	const nearest = target.lineage[0];
	const account = `account "${target.accountSlug}"`;
	const via = (b: Held) => (b.via === null ? '' : ` through group "${b.via}"`);
	const inherited = (id: string, path: string) =>
		nearest && id !== nearest.id ? `${path}, inherited by ${nearest.path}` : path;

	for (const b of held) {
		if (b.namespaceId !== null || !isAccountRole(b.role)) continue;
		if (rule.accountRoles?.includes(b.role)) {
			return allow(`${subject} is ${b.role} of ${account}${via(b)}`);
		}
		const implied = IMPLIED[b.role];
		if (rule.permission && nearest && LEVEL[implied] >= LEVEL[rule.permission]) {
			return allow(
				`${subject} is ${b.role} of ${account}${via(b)}, which gives ${implied} on every namespace in it`
			);
		}
	}

	if (rule.permission) {
		const needed = LEVEL[rule.permission];
		for (const ns of target.lineage) {
			const b = held.find(
				(h) =>
					h.caseId === null &&
					h.namespaceId === ns.id &&
					isNamespacePermission(h.role) &&
					LEVEL[h.role] >= needed
			);
			if (b) return allow(`${subject} holds ${b.role} on ${inherited(ns.id, ns.path)}${via(b)}`);
		}
	}

	if (rule.processRole && target.caseId !== undefined && target.role !== undefined) {
		const onCase = held.find((h) => h.caseId === target.caseId && h.role === target.role);
		if (onCase) return allow(`${subject} is bound as ${target.role} on this case${via(onCase)}`);
		for (const ns of target.lineage) {
			const b = held.find(
				(h) => h.caseId === null && h.namespaceId === ns.id && h.role === target.role
			);
			if (b) {
				return allow(
					`${subject} holds the standing role ${target.role} on ${inherited(ns.id, ns.path)}${via(b)}`
				);
			}
		}
	}

	const pathOf = (id: string | null) => target.lineage.find((n) => n.id === id)?.path;
	const holding =
		held.length === 0
			? `holds no role in ${account}${elsewhere ? '; roles in other accounts never apply here' : ''}`
			: `holds ${held
					.map(
						(h) =>
							`${h.role} on ${h.caseId !== null ? 'this case' : h.namespaceId === null ? account : pathOf(h.namespaceId)}${via(h)}`
					)
					.join(', ')}`;
	return refuse(
		`${subject} cannot ${rule.verb(target)} ${target.label}: that needs ${needs(rule, target)}, and it ${holding}`
	);
}

function needs(rule: ActionRule, target: Target): string {
	const nearest = target.lineage[0];
	const options: string[] = [];
	if (rule.permission && nearest) {
		const permissions = NAMESPACE_PERMISSIONS.filter(
			(p) => LEVEL[p] >= LEVEL[rule.permission!]
		).reverse();
		options.push(`${orList(permissions)} on ${nearest.path} or an ancestor`);
	}
	if (rule.processRole && nearest) {
		options.push(
			`the role ${target.role} on this case, or as a standing role on ${nearest.path} or an ancestor`
		);
	}
	const roles = ACCOUNT_ROLES.filter(
		(r) =>
			rule.accountRoles?.includes(r) ||
			(rule.permission && nearest && LEVEL[IMPLIED[r]] >= LEVEL[rule.permission])
	);
	if (roles.length > 0) options.push(`${orList(roles)} in account "${target.accountSlug}"`);
	return options.join(', or ');
}

/** Bindings in the target's account that bear on it: account scope, its lineage and its case. */
async function heldBindings(db: Queryable, principalId: string, target: Target): Promise<Held[]> {
	const lineageIds = target.lineage.map((n) => n.id);
	const onLineage = lineageIds.length
		? sql`OR (rb.case_id IS NULL AND rb.namespace_id IN ${lineageIds})`
		: sql``;
	const onCase = target.caseId === undefined ? sql`` : sql`OR rb.case_id = ${target.caseId}`;
	const rows = await db.execute<{
		role: string;
		namespace_id: string | null;
		case_id: string | null;
		via: string | null;
	}>(sql`
		${subjectsOf(principalId)}
		SELECT rb.role, rb.namespace_id, rb.case_id,
			CASE WHEN rb.principal_id = ${principalId}::uuid THEN NULL ELSE p.display_name END AS via
		FROM ${roleBindings} rb
		JOIN ${principals} p ON p.id = rb.principal_id
		WHERE rb.principal_id IN (SELECT id FROM subjects)
			AND rb.account_id = ${target.accountId}
			AND (rb.namespace_id IS NULL ${onLineage} ${onCase})
		ORDER BY rb.role, via NULLS FIRST`);
	return [...rows].map((r) => ({
		role: r.role,
		namespaceId: r.namespace_id,
		caseId: r.case_id,
		via: r.via
	}));
}

async function holdsRolesElsewhere(
	db: Queryable,
	principalId: string,
	target: Target
): Promise<boolean> {
	const [row] = await db.execute<{ elsewhere: boolean }>(sql`
		${subjectsOf(principalId)}
		SELECT EXISTS (
			SELECT 1 FROM ${roleBindings} rb
			WHERE rb.principal_id IN (SELECT id FROM subjects) AND rb.account_id <> ${target.accountId}
		) AS elsewhere`);
	return row?.elsewhere === true;
}

/** The principal and every group it belongs to, directly or through nested groups. */
const subjectsOf = (principalId: string) => sql`
	WITH RECURSIVE subjects(id) AS (
		SELECT ${principalId}::uuid
		UNION
		SELECT gm.group_id FROM ${groupMembers} gm JOIN subjects s ON gm.member_id = s.id
	)`;

async function principalById(db: Queryable, id: string): Promise<PrincipalRow | undefined> {
	const [row] = await db
		.select({
			id: principals.id,
			kind: principals.kind,
			displayName: principals.displayName,
			ownerId: principals.ownerId
		})
		.from(principals)
		.where(eq(principals.id, id));
	return row;
}

/** Loads the resource, its account and its namespace lineage, or says why it cannot. */
async function resolveTarget(db: Queryable, resource: Resource): Promise<Target | string> {
	switch (resource.type) {
		case 'account': {
			const [row] = await db
				.select({ slug: accounts.slug })
				.from(accounts)
				.where(eq(accounts.id, resource.accountId));
			if (!row) return `account ${resource.accountId} does not exist`;
			return {
				type: resource.type,
				label: `account "${row.slug}"`,
				accountId: resource.accountId,
				accountSlug: row.slug,
				lineage: []
			};
		}
		case 'namespace': {
			const [row] = await db
				.select({ accountId: namespaces.accountId, path: namespaces.path, slug: accounts.slug })
				.from(namespaces)
				.innerJoin(accounts, eq(accounts.id, namespaces.accountId))
				.where(eq(namespaces.id, resource.namespaceId));
			if (!row) return `namespace ${resource.namespaceId} does not exist`;
			return {
				type: resource.type,
				label: `namespace ${row.path}`,
				accountId: row.accountId,
				accountSlug: row.slug,
				lineage: await lineageOf(db, row.accountId, row.path)
			};
		}
		case 'definition':
		case 'publication': {
			const [row] = await db
				.select({
					slug: processDefinitions.slug,
					accountId: namespaces.accountId,
					path: namespaces.path,
					accountSlug: accounts.slug
				})
				.from(processDefinitions)
				.innerJoin(namespaces, eq(namespaces.id, processDefinitions.namespaceId))
				.innerJoin(accounts, eq(accounts.id, namespaces.accountId))
				.where(eq(processDefinitions.id, resource.definitionId));
			if (!row) return `definition ${resource.definitionId} does not exist`;
			return {
				type: resource.type,
				label: `definition "${row.slug}" in ${row.path}`,
				accountId: row.accountId,
				accountSlug: row.accountSlug,
				lineage: await lineageOf(db, row.accountId, row.path)
			};
		}
		case 'case':
		case 'case-role': {
			const [row] = await db
				.select({
					title: cases.title,
					accountId: namespaces.accountId,
					path: namespaces.path,
					accountSlug: accounts.slug
				})
				.from(cases)
				.innerJoin(namespaces, eq(namespaces.id, cases.namespaceId))
				.innerJoin(accounts, eq(accounts.id, namespaces.accountId))
				.where(eq(cases.id, resource.caseId));
			if (!row) return `case ${resource.caseId} does not exist`;
			return {
				type: resource.type,
				label: `case "${row.title}" in ${row.path}`,
				accountId: row.accountId,
				accountSlug: row.accountSlug,
				lineage: await lineageOf(db, row.accountId, row.path),
				caseId: resource.caseId,
				...(resource.type === 'case-role' ? { role: resource.role } : {})
			};
		}
	}
}

async function lineageOf(db: Queryable, accountId: string, path: string) {
	return db
		.select({ id: namespaces.id, path: namespaces.path })
		.from(namespaces)
		.where(
			and(
				eq(namespaces.accountId, accountId),
				inArray(namespaces.path, namespacePathPrefixes(path))
			)
		)
		.orderBy(desc(sql`length(${namespaces.path})`));
}

const nameOf = (p: PrincipalRow) => `${p.kind} "${p.displayName}"`;

const nobodyActsForAgents = (actor: PrincipalRow, agent: PrincipalRow) =>
	`nobody acts on behalf of an agent, so ${nameOf(actor)} cannot act for ${nameOf(agent)}`;

function orList(items: string[]): string {
	return items.length <= 1
		? (items[0] ?? '')
		: `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}

const allow = (reason: string): Decision => ({ allowed: true, reason });
const refuse = (reason: string): Decision => ({ allowed: false, reason });
