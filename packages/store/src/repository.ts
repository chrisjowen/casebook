// The only write path for the store tables. The database keeps declarative constraints (keys,
// foreign keys, NOT NULL, kind and status checks); every other rule is enforced here and
// refused with a StoreRuleError. A write given an `Authorization` also checks its actor with `can`
// (ADR 0017) inside the same transaction, and refuses with an AccessDeniedError.
import { and, desc, eq, inArray, isNull, max, sql } from 'drizzle-orm';
import {
	can,
	isAccountRole,
	isNamespacePermission,
	namespacePathPrefixes,
	type Action,
	type Actor,
	type Resource
} from './authz.js';
import type { Db, Queryable, Tx } from './client.js';
import {
	accounts,
	cases,
	caseVersionMoves,
	definitionVersions,
	delegationGrants,
	draftRevisions,
	groupMembers,
	namespaces,
	principals,
	processDefinitions,
	roleBindings
} from './schema.js';

export {
	ACCOUNT_ROLES,
	NAMESPACE_PERMISSIONS,
	namespacePathPrefixes,
	type AccountRole,
	type NamespacePermission
} from './authz.js';

export type Account = typeof accounts.$inferSelect;
export type Namespace = typeof namespaces.$inferSelect;
export type Principal = typeof principals.$inferSelect;
export type PrincipalKind = Principal['kind'];
export type GroupMember = typeof groupMembers.$inferSelect;
export type ProcessDefinition = typeof processDefinitions.$inferSelect;
export type DefinitionVersion = typeof definitionVersions.$inferSelect;
export type DraftRevision = typeof draftRevisions.$inferSelect;
export type Case = typeof cases.$inferSelect;
export type CaseBinding = Case['binding'];
export type ChangePolicy = ProcessDefinition['changePolicy'];
export type CaseVersionMoveRecord = typeof caseVersionMoves.$inferSelect;
export type RoleBinding = typeof roleBindings.$inferSelect;
export type DelegationGrant = typeof delegationGrants.$inferSelect;

export type StoreRule =
	| 'account-slug-format'
	| 'account-creator-kind'
	| 'namespace-create-forbidden'
	| 'namespace-path-format'
	| 'namespace-parent-missing'
	| 'principal-owner-agent-only'
	| 'principal-owner-kind'
	| 'group-member-self'
	| 'definition-slug-format'
	| 'definition-missing'
	| 'definition-living'
	| 'edit-publish-fields'
	| 'revision-other-definition'
	| 'revision-conflict'
	| 'publish-body-missing'
	| 'publish-body-mismatch'
	| 'draft-author-kind'
	| 'draft-on-behalf-of-required'
	| 'draft-on-behalf-of-forbidden'
	| 'draft-on-behalf-of-kind'
	| 'principal-missing'
	| 'version-missing'
	| 'version-not-published'
	| 'version-retired'
	| 'case-missing'
	| 'case-namespace-outside-definition'
	| 'case-follow-needs-latest'
	| 'case-move-not-pinned'
	| 'case-move-other-definition'
	| 'case-move-not-newer'
	| 'role-blank'
	| 'role-scope'
	| 'role-case-needs-namespace'
	| 'delegation-case-needs-namespace'
	| 'delegation-expiry-past'
	| 'delegation-missing'
	| 'actor-mismatch'
	| 'access-denied';

/** A write the repository refused because it breaks a store rule. */
export class StoreRuleError extends Error {
	override readonly name = 'StoreRuleError';
	constructor(
		readonly rule: StoreRule,
		message: string
	) {
		super(message);
	}
}

type AccessRule = Extract<StoreRule, 'access-denied' | 'namespace-create-forbidden'>;

/** A write refused because its actor lacks the permission; `reason` says which rule refused. */
export class AccessDeniedError extends StoreRuleError {
	constructor(
		rule: AccessRule,
		readonly action: Action,
		readonly reason: string
	) {
		super(rule, reason);
	}
}

/**
 * Asks a write to check its actor's permission with `can` before writing. Writes that record who
 * made them refuse an actor other than the one recorded.
 */
export interface Authorization {
	actor: Actor;
	/** The time delegation expiry is checked against; defaults to now. */
	now?: Date;
}

/** Throws an AccessDeniedError unless `actor` may perform `action` on `resource`. */
async function authorize(
	db: Queryable,
	auth: Authorization,
	action: Action,
	resource: Resource,
	rule: AccessRule = 'access-denied'
) {
	const decision = await can(
		db,
		auth.actor,
		action,
		resource,
		auth.now === undefined ? {} : { now: auth.now }
	);
	if (!decision.allowed) throw new AccessDeniedError(rule, action, decision.reason);
}

/** Refuses an authorization whose actor is not the principal the write records as acting. */
function requireRecordedActor(
	auth: Authorization,
	recorded: {
		id: string;
		/** Null when the write records acting for nobody; omitted when it records no such field. */
		onBehalfOfId?: string | null;
		field: string;
	}
) {
	const sameFor =
		recorded.onBehalfOfId === undefined ||
		(auth.actor.onBehalfOfId ?? null) === recorded.onBehalfOfId;
	if (auth.actor.id !== recorded.id || !sameFor) {
		throw new StoreRuleError(
			'actor-mismatch',
			`the authorized actor ${auth.actor.id} is not the ${recorded.field} the write records`
		);
	}
}

const SEGMENT = /^[^/\s]+$/;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function requireRole(role: string) {
	if (role.trim() === '') throw new StoreRuleError('role-blank', 'role names cannot be blank');
}

// Accounts

export interface NewAccount {
	slug: string;
	displayName: string;
	/** A user, who becomes the account's first account-owner. */
	createdById: string;
}

/** Creates an account and binds its creator as account-owner. */
export async function createAccount(db: Db, input: NewAccount): Promise<Account> {
	if (!SLUG.test(input.slug)) {
		throw new StoreRuleError(
			'account-slug-format',
			`account slug "${input.slug}" must be lowercase words joined by "-"`
		);
	}
	return db.transaction(async (tx) => {
		const creatorKind = await principalKindOf(tx, input.createdById);
		if (creatorKind !== 'user') {
			throw new StoreRuleError(
				'account-creator-kind',
				`an account is created by a user, not a ${creatorKind}`
			);
		}
		const [account] = await tx.insert(accounts).values(input).returning();
		await tx.insert(roleBindings).values({
			principalId: input.createdById,
			role: 'account-owner',
			accountId: account!.id
		});
		return account!;
	});
}

// Namespaces

export interface NewNamespace {
	accountId: string;
	path: string;
	createdById: string;
}

/**
 * Creates the namespace at `path` in an account and binds its creator as namespace-admin.
 *
 * The parent is the path minus its last segment, in the same account, and must already exist.
 * The creator needs developer or above in the account, or namespace-admin on the parent or one
 * of its ancestors, held directly or through a group (ADR 0015). `can` decides, for `auth.actor`
 * when given, which must be the creator, and otherwise for the creator. When the creator acts on
 * behalf of another principal, as an agent does, the principal it represents is bound as
 * namespace-admin.
 * Namespaces are never moved or renamed, since that would rewrite descendants.
 */
export async function createNamespace(
	db: Db,
	input: NewNamespace,
	auth?: Authorization
): Promise<Namespace> {
	const { accountId, path, createdById } = input;
	if (auth) requireRecordedActor(auth, { id: createdById, field: 'creator' });
	const segments = path.split('/');
	if (!segments.every((s) => SEGMENT.test(s))) {
		throw new StoreRuleError(
			'namespace-path-format',
			`namespace path "${path}" must be non-empty segments separated by "/", without spaces`
		);
	}
	return db.transaction(async (tx) => {
		let parentId: string | null = null;
		if (segments.length > 1) {
			const parentPath = segments.slice(0, -1).join('/');
			// Lock the parent's lineage so it is still there when the child is inserted.
			const lineage = await tx
				.select({ id: namespaces.id, path: namespaces.path })
				.from(namespaces)
				.where(
					and(
						eq(namespaces.accountId, accountId),
						inArray(namespaces.path, namespacePathPrefixes(parentPath))
					)
				)
				.for('share');
			const parent = lineage.find((n) => n.path === parentPath);
			if (!parent) {
				throw new StoreRuleError(
					'namespace-parent-missing',
					`namespace "${path}" needs parent "${parentPath}" to exist first`
				);
			}
			parentId = parent.id;
		}

		await authorize(
			tx,
			auth ?? { actor: { id: createdById } },
			'namespace.create',
			parentId === null
				? { type: 'account', accountId }
				: { type: 'namespace', namespaceId: parentId },
			'namespace-create-forbidden'
		);

		const [row] = await tx
			.insert(namespaces)
			.values({ accountId, path, parentId, createdById })
			.returning();
		await tx.insert(roleBindings).values({
			principalId: auth?.actor.onBehalfOfId ?? createdById,
			role: 'namespace-admin',
			accountId,
			namespaceId: row!.id
		});
		return row!;
	});
}

/**
 * The namespace at `path` and its existing ancestors, nearest first. This is the order role
 * bindings and other inherited lookups resolve in (ADR 0007, ADR 0008).
 */
export async function findNamespaceLineage(
	db: Db,
	accountId: string,
	path: string
): Promise<Namespace[]> {
	return db
		.select()
		.from(namespaces)
		.where(
			and(
				eq(namespaces.accountId, accountId),
				inArray(namespaces.path, namespacePathPrefixes(path))
			)
		)
		.orderBy(desc(sql`length(${namespaces.path})`));
}

// Principals

export interface NewPrincipal {
	kind: PrincipalKind;
	displayName: string;
	issuer: string;
	subject: string;
	/** The service principal an unattended agent acts for (ADR 0009). Agents only. */
	ownerId?: string;
}

export async function createPrincipal(db: Db, input: NewPrincipal): Promise<Principal> {
	if (input.ownerId !== undefined && input.kind !== 'agent') {
		throw new StoreRuleError(
			'principal-owner-agent-only',
			`only agents have an owning service principal, not a ${input.kind}`
		);
	}
	return db.transaction(async (tx) => {
		if (input.ownerId !== undefined) {
			const owner = await principalKindOf(tx, input.ownerId);
			if (owner !== 'service') {
				throw new StoreRuleError(
					'principal-owner-kind',
					`an agent's owner must be a service principal, not a ${owner}`
				);
			}
		}
		const [row] = await tx
			.insert(principals)
			.values({ ...input, ownerId: input.ownerId ?? null })
			.returning();
		return row!;
	});
}

/** Adds a direct member to a group. Members may themselves be groups. */
export async function addGroupMember(
	db: Db,
	groupId: string,
	memberId: string
): Promise<GroupMember> {
	if (groupId === memberId) {
		throw new StoreRuleError('group-member-self', 'a group cannot be a member of itself');
	}
	const [row] = await db.insert(groupMembers).values({ groupId, memberId }).returning();
	return row!;
}

async function principalKindOf(tx: Tx, id: string): Promise<PrincipalKind> {
	const [row] = await tx
		.select({ kind: principals.kind })
		.from(principals)
		.where(eq(principals.id, id))
		.for('share');
	if (!row) throw new StoreRuleError('principal-missing', `principal ${id} does not exist`);
	return row.kind;
}

// Definitions, drafts and versions

export interface NewProcessDefinition {
	namespaceId: string;
	slug: string;
	ownerId: string;
	createdById: string;
	/** Defaults to governed (ADR 0016). */
	changePolicy?: ChangePolicy;
	/** Policy flag only for now: a governed publish needs an approval. */
	publishRequiresApproval?: boolean;
}

/** Creates a definition. With `auth`, its actor must be the creator and may create definitions. */
export async function createProcessDefinition(
	db: Db,
	input: NewProcessDefinition,
	auth?: Authorization
): Promise<ProcessDefinition> {
	if (!SLUG.test(input.slug)) {
		throw new StoreRuleError(
			'definition-slug-format',
			`definition slug "${input.slug}" must be lowercase words joined by "-"`
		);
	}
	if (auth) requireRecordedActor(auth, { id: input.createdById, field: 'creator' });
	return db.transaction(async (tx) => {
		if (auth) {
			await authorize(tx, auth, 'definition.create', {
				type: 'namespace',
				namespaceId: input.namespaceId
			});
		}
		const [row] = await tx.insert(processDefinitions).values(input).returning();
		return row!;
	});
}

/**
 * Locks a definition so its revision and version numbers are assigned one writer at a time,
 * and returns its change policy.
 */
async function lockDefinition(tx: Tx, definitionId: string): Promise<ChangePolicy> {
	const [row] = await tx
		.select({ changePolicy: processDefinitions.changePolicy })
		.from(processDefinitions)
		.where(eq(processDefinitions.id, definitionId))
		.for('update');
	if (!row) {
		throw new StoreRuleError('definition-missing', `definition ${definitionId} does not exist`);
	}
	return row.changePolicy;
}

/** What a published version records beyond its body. */
export interface VersionFields {
	schemaVersion: string;
	contentHash: string;
}

export interface NewDraftRevision {
	definitionId: string;
	body: unknown;
	/** The node operations that produced the body from the previous revision (ADR 0019). */
	ops?: unknown[];
	/** The earlier revision whose body this one restores, as undo does. */
	revertedTo?: number;
	/**
	 * The number the revision must get. When another edit got there first the write is refused,
	 * so an edit computed from a stale head is never stored.
	 */
	revision?: number;
	authorId: string;
	/** Required for agent and service authors, forbidden for users (ADR 0009). */
	onBehalfOfId?: string;
	/** Required for a living definition, whose every edit is published; forbidden for governed. */
	publish?: VersionFields;
}

export interface RecordedEdit {
	revision: DraftRevision;
	/** The version a living definition published from this edit; null for governed. */
	version: DefinitionVersion | null;
}

/**
 * Records an edit as the next revision of a definition's draft (ADR 0002). For a living
 * definition the edit is also published as a new version, authored and published by the editor,
 * and following cases move to it (ADR 0016).
 *
 * A user author edits for themselves. An agent or service author records the user, group or
 * service principal it acts for; a service may act for itself. Nobody acts for an agent.
 *
 * With `auth`, its actor must be the author acting for the recorded principal, and may edit the
 * definition, and also publish it when the definition is living.
 */
export async function appendDraftRevision(
	db: Db,
	input: NewDraftRevision,
	auth?: Authorization
): Promise<RecordedEdit> {
	if (auth) {
		requireRecordedActor(auth, {
			id: input.authorId,
			onBehalfOfId: input.onBehalfOfId ?? null,
			field: 'author'
		});
	}
	return db.transaction(async (tx) => {
		const authorKind = await principalKindOf(tx, input.authorId);
		if (authorKind === 'group') {
			throw new StoreRuleError('draft-author-kind', 'a group cannot author a draft revision');
		}
		let onBehalfOfKind: PrincipalKind | null = null;
		if (authorKind === 'user') {
			if (input.onBehalfOfId !== undefined) {
				throw new StoreRuleError(
					'draft-on-behalf-of-forbidden',
					'a user edits a draft for themselves and cannot act on behalf of another principal'
				);
			}
		} else {
			if (input.onBehalfOfId === undefined) {
				throw new StoreRuleError(
					'draft-on-behalf-of-required',
					`a ${authorKind} author must record the principal it acts for`
				);
			}
			onBehalfOfKind = await principalKindOf(tx, input.onBehalfOfId);
			if (onBehalfOfKind === 'agent') {
				throw new StoreRuleError(
					'draft-on-behalf-of-kind',
					'a draft revision cannot be made on behalf of an agent'
				);
			}
		}

		const policy = await lockDefinition(tx, input.definitionId);
		if ((policy === 'living') !== (input.publish !== undefined)) {
			throw new StoreRuleError(
				'edit-publish-fields',
				policy === 'living'
					? 'an edit to a living definition is published, so it needs schemaVersion and contentHash'
					: 'an edit to a governed definition is a draft; publish it with publishVersion'
			);
		}
		if (auth) {
			const definition = { type: 'definition', definitionId: input.definitionId } as const;
			await authorize(tx, auth, 'definition.edit', definition);
			if (policy === 'living') await authorize(tx, auth, 'definition.publish', definition);
		}
		const [last] = await tx
			.select({ revision: max(draftRevisions.revision) })
			.from(draftRevisions)
			.where(eq(draftRevisions.definitionId, input.definitionId));
		const next = (last?.revision ?? 0) + 1;
		if (input.revision !== undefined && input.revision !== next) {
			throw new StoreRuleError(
				'revision-conflict',
				`the draft moved on: the next revision is ${next}, not ${input.revision}`
			);
		}
		const [revision] = await tx
			.insert(draftRevisions)
			.values({
				definitionId: input.definitionId,
				revision: next,
				body: input.body,
				ops: input.ops ?? [],
				revertedTo: input.revertedTo ?? null,
				authorId: input.authorId,
				authorKind,
				onBehalfOfId: input.onBehalfOfId ?? null,
				onBehalfOfKind
			})
			.returning();

		const version = input.publish
			? await insertVersion(tx, {
					definitionId: input.definitionId,
					body: input.body,
					...input.publish,
					authorId: input.authorId,
					publishedById: input.authorId,
					sourceRevisionId: revision!.id
				})
			: null;
		return { revision: revision!, version };
	});
}

export interface NewDefinitionVersion extends VersionFields {
	definitionId: string;
	/** Needed without a source revision; with one, the body is the revision's and may be omitted. */
	body?: unknown;
	authorId: string;
	publishedById: string;
	/** The draft revision being published, which must belong to the definition. */
	sourceRevisionId?: string;
}

/** Assigns the next version number, inserts the version and moves following cases to it. */
async function insertVersion(
	tx: Tx,
	input: NewDefinitionVersion & { body: unknown }
): Promise<DefinitionVersion> {
	const [last] = await tx
		.select({ version: max(definitionVersions.version) })
		.from(definitionVersions)
		.where(eq(definitionVersions.definitionId, input.definitionId));
	const [version] = await tx
		.insert(definitionVersions)
		.values({ ...input, version: (last?.version ?? 0) + 1, status: 'published' })
		.returning();
	await tx
		.update(cases)
		.set({ definitionVersionId: version!.id })
		.where(
			and(
				eq(cases.binding, 'follow_latest'),
				inArray(
					cases.definitionVersionId,
					tx
						.select({ id: definitionVersions.id })
						.from(definitionVersions)
						.where(eq(definitionVersions.definitionId, input.definitionId))
				)
			)
		);
	return version!;
}

/**
 * Publishes the next numbered version of a governed definition, typically from a draft revision.
 * Published from a revision, the version takes that revision's body and records it as its source;
 * a different explicit body is refused. Published from an explicit body alone, it records no
 * source. Versions are immutable once written: the repository offers no way to change or delete one
 * except `retireVersion`. Living definitions publish on every edit instead.
 *
 * With `auth`, its actor must be the publisher and may publish the definition. The approval a
 * definition's policy may require is not enforced here yet.
 */
export async function publishVersion(
	db: Db,
	input: NewDefinitionVersion,
	auth?: Authorization
): Promise<DefinitionVersion> {
	if (auth) requireRecordedActor(auth, { id: input.publishedById, field: 'publisher' });
	return db.transaction(async (tx) => {
		const policy = await lockDefinition(tx, input.definitionId);
		if (auth) {
			await authorize(tx, auth, 'definition.publish', {
				type: 'definition',
				definitionId: input.definitionId
			});
		}
		if (policy === 'living') {
			throw new StoreRuleError(
				'definition-living',
				'a living definition publishes each edit; record an edit with appendDraftRevision'
			);
		}
		if (input.sourceRevisionId === undefined) {
			if (input.body === undefined) {
				throw new StoreRuleError(
					'publish-body-missing',
					'a version is published from a source revision or an explicit body'
				);
			}
			return insertVersion(tx, { ...input, body: input.body });
		}
		const [source] = await tx
			.select({
				definitionId: draftRevisions.definitionId,
				body: draftRevisions.body,
				sameBody:
					input.body === undefined
						? sql<boolean>`true`
						: sql<boolean>`${draftRevisions.body} = ${JSON.stringify(input.body)}::jsonb`
			})
			.from(draftRevisions)
			.where(eq(draftRevisions.id, input.sourceRevisionId));
		if (source?.definitionId !== input.definitionId) {
			throw new StoreRuleError(
				'revision-other-definition',
				`draft revision ${input.sourceRevisionId} is not a revision of definition ${input.definitionId}`
			);
		}
		if (!source.sameBody) {
			throw new StoreRuleError(
				'publish-body-mismatch',
				`the body differs from draft revision ${input.sourceRevisionId}; publish the revision's body or omit it`
			);
		}
		return insertVersion(tx, { ...input, body: source.body });
	});
}

/**
 * Retires a published version, the only change a version allows. It then takes no new cases.
 * With `auth`, its actor may retire versions of the definition.
 */
export async function retireVersion(
	db: Db,
	versionId: string,
	auth?: Authorization
): Promise<DefinitionVersion> {
	return db.transaction(async (tx) => {
		const notPublished = () =>
			new StoreRuleError(
				'version-not-published',
				`definition version ${versionId} is not a published version`
			);
		if (auth) {
			const [version] = await tx
				.select({ definitionId: definitionVersions.definitionId })
				.from(definitionVersions)
				.where(eq(definitionVersions.id, versionId));
			if (!version) throw notPublished();
			await authorize(tx, auth, 'definition.retire', {
				type: 'definition',
				definitionId: version.definitionId
			});
		}
		const [row] = await tx
			.update(definitionVersions)
			.set({ status: 'retired' })
			.where(and(eq(definitionVersions.id, versionId), eq(definitionVersions.status, 'published')))
			.returning();
		if (!row) throw notPublished();
		return row;
	});
}

// Cases

/**
 * Locks a version against retiring, and its definition against publishing, and returns what
 * binding a case in `caseNamespaceId` to it needs. The case namespace must be the definition's
 * namespace or one of its descendants, in the same account (ADR 0007, ADR 0015).
 */
async function versionForBinding(tx: Tx, versionId: string, caseNamespaceId: string) {
	const [version] = await tx
		.select({
			definitionId: definitionVersions.definitionId,
			version: definitionVersions.version,
			status: definitionVersions.status,
			changePolicy: processDefinitions.changePolicy,
			accountId: namespaces.accountId,
			namespacePath: namespaces.path
		})
		.from(definitionVersions)
		.innerJoin(processDefinitions, eq(processDefinitions.id, definitionVersions.definitionId))
		.innerJoin(namespaces, eq(namespaces.id, processDefinitions.namespaceId))
		.where(eq(definitionVersions.id, versionId))
		// FOR SHARE makes a concurrent retire or publish wait until the binding is written.
		.for('share', { of: [definitionVersions, processDefinitions] });
	if (!version) {
		throw new StoreRuleError('version-missing', `definition version ${versionId} does not exist`);
	}
	if (version.status !== 'published') {
		throw new StoreRuleError(
			'version-retired',
			`definition version ${versionId} is retired and takes no new cases`
		);
	}
	const [caseNamespace] = await tx
		.select({ accountId: namespaces.accountId, path: namespaces.path })
		.from(namespaces)
		.where(eq(namespaces.id, caseNamespaceId));
	const inside =
		caseNamespace?.accountId === version.accountId &&
		(caseNamespace.path === version.namespacePath ||
			caseNamespace.path.startsWith(`${version.namespacePath}/`));
	if (!inside) {
		throw new StoreRuleError(
			'case-namespace-outside-definition',
			`namespace ${caseNamespaceId} is not "${version.namespacePath}" or one of its descendants in the definition's account`
		);
	}
	return version;
}

export interface NewCase {
	namespaceId: string;
	definitionVersionId: string;
	title: string;
	/** Defaults to pinned for a governed definition and follow_latest for a living one. */
	binding?: CaseBinding;
}

/**
 * Creates a case bound to a published definition version (ADR 0002, ADR 0016), in the
 * definition's namespace or one of its descendants. A following case must start on the
 * definition's latest published version.
 */
export async function createCase(db: Db, input: NewCase): Promise<Case> {
	return db.transaction(async (tx) => {
		const version = await versionForBinding(tx, input.definitionVersionId, input.namespaceId);
		const binding =
			input.binding ?? (version.changePolicy === 'living' ? 'follow_latest' : 'pinned');
		if (binding === 'follow_latest') {
			const [latest] = await tx
				.select({ version: max(definitionVersions.version) })
				.from(definitionVersions)
				.where(
					and(
						eq(definitionVersions.definitionId, version.definitionId),
						eq(definitionVersions.status, 'published')
					)
				);
			if (latest?.version !== version.version) {
				throw new StoreRuleError(
					'case-follow-needs-latest',
					`a following case starts on the latest published version, not version ${version.version}`
				);
			}
		}
		const [row] = await tx
			.insert(cases)
			.values({ ...input, binding })
			.returning();
		return row!;
	});
}

export interface CaseVersionMove {
	caseId: string;
	toVersionId: string;
	movedById: string;
}

/**
 * Moves a pinned case to a newer published version of its definition, and records who moved it,
 * when, and from and to which version (ADR 0016). Following cases move on their own.
 * With `auth`, its actor must be the mover and may move the case's version.
 */
export async function moveCaseVersion(
	db: Db,
	input: CaseVersionMove,
	auth?: Authorization
): Promise<Case> {
	if (auth) requireRecordedActor(auth, { id: input.movedById, field: 'mover' });
	return db.transaction(async (tx) => {
		const [current] = await tx
			.select({
				binding: cases.binding,
				namespaceId: cases.namespaceId,
				versionId: cases.definitionVersionId,
				definitionId: definitionVersions.definitionId,
				version: definitionVersions.version
			})
			.from(cases)
			.innerJoin(definitionVersions, eq(definitionVersions.id, cases.definitionVersionId))
			.where(eq(cases.id, input.caseId))
			.for('update', { of: cases });
		if (!current) throw new StoreRuleError('case-missing', `case ${input.caseId} does not exist`);
		if (auth)
			await authorize(tx, auth, 'case.bind_version', { type: 'case', caseId: input.caseId });
		if (current.binding !== 'pinned') {
			throw new StoreRuleError(
				'case-move-not-pinned',
				'a following case tracks the latest version and is not moved by hand'
			);
		}
		const target = await versionForBinding(tx, input.toVersionId, current.namespaceId);
		if (target.definitionId !== current.definitionId) {
			throw new StoreRuleError(
				'case-move-other-definition',
				`version ${input.toVersionId} belongs to another definition`
			);
		}
		if (target.version <= current.version) {
			throw new StoreRuleError(
				'case-move-not-newer',
				`a case moves to a newer version, not from version ${current.version} to ${target.version}`
			);
		}
		const [moved] = await tx
			.update(cases)
			.set({ definitionVersionId: input.toVersionId })
			.where(eq(cases.id, input.caseId))
			.returning();
		await tx.insert(caseVersionMoves).values({
			caseId: input.caseId,
			fromVersionId: current.versionId,
			toVersionId: input.toVersionId,
			movedById: input.movedById
		});
		return moved!;
	});
}

// Role bindings and delegation

export interface NewRoleBinding {
	principalId: string;
	role: string;
	accountId: string;
	/** For namespace and case scope; the database refuses a namespace outside the account. */
	namespaceId?: string;
	/** For case scope, with the case's namespace; the database refuses a mismatch. */
	caseId?: string;
}

/**
 * Stores a `(principal, role, scope)` tuple (ADR 0008, ADR 0015). Account scope takes only the
 * built-in account roles. Namespace scope takes the built-in namespace permissions or standing
 * process roles. Case scope takes process roles only.
 */
export async function bindRole(db: Db, input: NewRoleBinding): Promise<RoleBinding> {
	const { role, namespaceId, caseId } = input;
	requireRole(role);
	if (caseId !== undefined && namespaceId === undefined) {
		throw new StoreRuleError(
			'role-case-needs-namespace',
			"a case binding must also name the case's namespace"
		);
	}
	const scope = caseId !== undefined ? 'case' : namespaceId !== undefined ? 'namespace' : 'account';
	const allowed =
		scope === 'account'
			? isAccountRole(role)
			: scope === 'namespace'
				? !isAccountRole(role)
				: !isAccountRole(role) && !isNamespacePermission(role);
	if (!allowed) {
		throw new StoreRuleError('role-scope', `role "${role}" cannot be bound at ${scope} scope`);
	}
	const [row] = await db
		.insert(roleBindings)
		.values({ ...input, namespaceId: namespaceId ?? null, caseId: caseId ?? null })
		.returning();
	return row!;
}

export interface NewDelegationGrant {
	delegatorId: string;
	agentId: string;
	namespaceId?: string;
	/** Needs `namespaceId` set to the case's namespace. */
	caseId?: string;
	role?: string;
	expiresAt: Date;
}

/** Records a user's expiring grant letting an agent act on their behalf (ADR 0009). */
export async function grantDelegation(
	db: Db,
	input: NewDelegationGrant,
	now: Date = new Date()
): Promise<DelegationGrant> {
	if (input.role !== undefined) requireRole(input.role);
	if (input.caseId !== undefined && input.namespaceId === undefined) {
		throw new StoreRuleError(
			'delegation-case-needs-namespace',
			"a case-limited delegation must also name the case's namespace"
		);
	}
	if (input.expiresAt <= now) {
		throw new StoreRuleError('delegation-expiry-past', 'a delegation must expire in the future');
	}
	const [row] = await db
		.insert(delegationGrants)
		.values({
			...input,
			namespaceId: input.namespaceId ?? null,
			caseId: input.caseId ?? null,
			role: input.role ?? null
		})
		.returning();
	return row!;
}

/** Revokes an active delegation grant. */
export async function revokeDelegation(
	db: Db,
	grantId: string,
	now: Date = new Date()
): Promise<DelegationGrant> {
	const [row] = await db
		.update(delegationGrants)
		.set({ revokedAt: now })
		.where(and(eq(delegationGrants.id, grantId), isNull(delegationGrants.revokedAt)))
		.returning();
	if (!row) {
		throw new StoreRuleError(
			'delegation-missing',
			`delegation grant ${grantId} does not exist or is already revoked`
		);
	}
	return row;
}
