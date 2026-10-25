// Drizzle table definitions for definition storage (ADR 0002), namespaces (ADR 0007),
// principals and role bindings (ADR 0008) and agent delegation (ADR 0009).
// The database holds declarative constraints only: keys, foreign keys, NOT NULL and checks on
// kind and status columns. Every other rule (namespace paths, version immutability, case
// pinning, formats) lives in `repository.ts`, the only write path for these tables.
import { sql } from 'drizzle-orm';
import {
	type AnyPgColumn,
	boolean,
	check,
	foreignKey,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	primaryKey,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
	timestamp('updated_at', { withTimezone: true })
		.notNull()
		.defaultNow()
		.$onUpdate(() => new Date());

export const principalKind = pgEnum('principal_kind', ['user', 'group', 'agent', 'service']);
export const changePolicy = pgEnum('change_policy', ['governed', 'living']);
export const caseBinding = pgEnum('case_binding', ['pinned', 'follow_latest']);
export const definitionVersionStatus = pgEnum('definition_version_status', [
	'published',
	'retired'
]);

/**
 * The top-level tenant (ADR 0015). Every namespace belongs to exactly one account, and principals
 * become members of an account through account-scoped role bindings.
 */
export const accounts = pgTable(
	'accounts',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		slug: text('slug').notNull(),
		displayName: text('display_name').notNull(),
		createdById: uuid('created_by_id')
			.notNull()
			.references((): AnyPgColumn => principals.id),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [unique('accounts_slug_key').on(t.slug)]
);

/**
 * Hierarchical namespaces such as `acme/eng/sre`, unique per account. A child namespace sits in
 * its parent's account, which a composite foreign key to `(id, account_id)` enforces.
 *
 * `path` is a materialized path rather than ltree: segments come from user-facing names
 * (for example `personal/<user>/family`) that ltree's label alphabet would reject, no extension
 * is needed, and ancestors resolve with an equality lookup on the unique path index for every
 * prefix of the path. The repository derives `parent_id` from the path and offers no move or
 * rename, which would need a rewrite of every descendant path.
 */
export const namespaces = pgTable(
	'namespaces',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		accountId: uuid('account_id')
			.notNull()
			.references(() => accounts.id),
		parentId: uuid('parent_id'),
		path: text('path').notNull(),
		createdById: uuid('created_by_id')
			.notNull()
			.references((): AnyPgColumn => principals.id),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		uniqueIndex('namespaces_account_path_key').on(t.accountId, t.path),
		unique('namespaces_id_account_key').on(t.id, t.accountId),
		index('namespaces_parent_id_idx').on(t.parentId),
		foreignKey({
			name: 'namespaces_parent_fk',
			columns: [t.parentId, t.accountId],
			foreignColumns: [t.id, t.accountId]
		})
	]
);

/**
 * Users, groups, agents and service principals, keyed by OIDC-shaped `(issuer, subject)`.
 *
 * Tables that need a principal of a particular kind carry a constant `*_kind` column and a
 * composite foreign key to `(id, kind)`, so the kind rule is declarative and a principal's
 * kind cannot change while something depends on it.
 */
export const principals = pgTable(
	'principals',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		kind: principalKind('kind').notNull(),
		displayName: text('display_name').notNull(),
		issuer: text('issuer').notNull(),
		subject: text('subject').notNull(),
		/** The service principal an unattended agent acts for (ADR 0009). Agents only. */
		ownerId: uuid('owner_id'),
		ownerKind: principalKind('owner_kind').notNull().default('service'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		unique('principals_issuer_subject_key').on(t.issuer, t.subject),
		unique('principals_id_kind_key').on(t.id, t.kind),
		foreignKey({
			name: 'principals_owner_fk',
			columns: [t.ownerId, t.ownerKind],
			foreignColumns: [t.id, t.kind]
		}),
		check('principals_owner_kind_service', sql`${t.ownerKind} = 'service'`),
		check('principals_owner_agent_only', sql`${t.ownerId} IS NULL OR ${t.kind} = 'agent'`)
	]
);

/** Direct members of a group. Members may themselves be groups. */
export const groupMembers = pgTable(
	'group_members',
	{
		groupId: uuid('group_id').notNull(),
		groupKind: principalKind('group_kind').notNull().default('group'),
		memberId: uuid('member_id')
			.notNull()
			.references(() => principals.id, { onDelete: 'cascade' }),
		createdAt: createdAt()
	},
	(t) => [
		primaryKey({ columns: [t.groupId, t.memberId] }),
		index('group_members_member_id_idx').on(t.memberId),
		foreignKey({
			name: 'group_members_group_fk',
			columns: [t.groupId, t.groupKind],
			foreignColumns: [principals.id, principals.kind]
		}).onDelete('cascade'),
		check('group_members_group_kind_group', sql`${t.groupKind} = 'group'`)
	]
);

/** A named process in a namespace. Its content lives in draft revisions and published versions. */
export const processDefinitions = pgTable(
	'process_definitions',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		namespaceId: uuid('namespace_id')
			.notNull()
			.references(() => namespaces.id),
		slug: text('slug').notNull(),
		ownerId: uuid('owner_id')
			.notNull()
			.references(() => principals.id),
		createdById: uuid('created_by_id')
			.notNull()
			.references(() => principals.id),
		/**
		 * Governed: edits go to draft revisions and an explicit publish creates a version.
		 * Living: every accepted edit is published as a new version (ADR 0016).
		 */
		changePolicy: changePolicy('change_policy').notNull().default('governed'),
		/** Policy flag only: a governed publish needs an approval. The approval flow comes later. */
		publishRequiresApproval: boolean('publish_requires_approval').notNull().default(false),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [unique('process_definitions_namespace_slug_key').on(t.namespaceId, t.slug)]
);

/**
 * A published, numbered version of a definition, created at publish time. Drafts live only in
 * `draft_revisions`. The body is validated by the model layer, not here.
 *
 * A row is immutable (ADR 0002): the repository's only change is retiring a published
 * version, and it offers no delete.
 */
export const definitionVersions = pgTable(
	'definition_versions',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		definitionId: uuid('definition_id')
			.notNull()
			.references(() => processDefinitions.id),
		version: integer('version').notNull(),
		status: definitionVersionStatus('status').notNull().default('published'),
		body: jsonb('body').notNull(),
		schemaVersion: text('schema_version').notNull(),
		contentHash: text('content_hash').notNull(),
		authorId: uuid('author_id')
			.notNull()
			.references(() => principals.id),
		publishedById: uuid('published_by_id')
			.notNull()
			.references(() => principals.id),
		publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
		/** The draft revision this version was published from, when there is one. */
		sourceRevisionId: uuid('source_revision_id').references((): AnyPgColumn => draftRevisions.id),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [unique('definition_versions_definition_version_key').on(t.definitionId, t.version)]
);

/**
 * Edit history of a definition's draft, the only place drafts live (ADR 0002).
 *
 * Following ADR 0009, a user author edits for themselves and leaves `on_behalf_of` unset, while
 * an agent or service author records the user, group or service principal it acts for. Both
 * kinds are checked through composite foreign keys to `(id, kind)`.
 */
export const draftRevisions = pgTable(
	'draft_revisions',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		definitionId: uuid('definition_id')
			.notNull()
			.references(() => processDefinitions.id),
		revision: integer('revision').notNull(),
		body: jsonb('body').notNull(),
		/** The node operations that produced this revision from the one before (ADR 0019). */
		ops: jsonb('ops').notNull().default([]),
		/** The earlier revision whose body this one restores, as undo does. */
		revertedTo: integer('reverted_to'),
		authorId: uuid('author_id').notNull(),
		authorKind: principalKind('author_kind').notNull(),
		onBehalfOfId: uuid('on_behalf_of_id'),
		onBehalfOfKind: principalKind('on_behalf_of_kind'),
		createdAt: createdAt()
	},
	(t) => [
		unique('draft_revisions_definition_revision_key').on(t.definitionId, t.revision),
		foreignKey({
			name: 'draft_revisions_author_fk',
			columns: [t.authorId, t.authorKind],
			foreignColumns: [principals.id, principals.kind]
		}),
		foreignKey({
			name: 'draft_revisions_on_behalf_of_fk',
			columns: [t.onBehalfOfId, t.onBehalfOfKind],
			foreignColumns: [principals.id, principals.kind]
		}),
		check(
			'draft_revisions_on_behalf_of_kind',
			sql`(${t.onBehalfOfId} IS NULL) = (${t.onBehalfOfKind} IS NULL)
				AND ${t.onBehalfOfKind} IS DISTINCT FROM 'agent'`
		),
		check(
			'draft_revisions_author_on_behalf_of',
			sql`(${t.authorKind} = 'user' AND ${t.onBehalfOfId} IS NULL)
				OR (${t.authorKind} IN ('agent', 'service') AND ${t.onBehalfOfId} IS NOT NULL)`
		)
	]
);

/**
 * Stub of the case runtime table: only what case-scoped role bindings and delegations need.
 * The rest of the case runtime (facts, evidence, events) is deferred. A case binds a published
 * definition version; the repository refuses binding a retired one.
 */
export const cases = pgTable(
	'cases',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		namespaceId: uuid('namespace_id')
			.notNull()
			.references(() => namespaces.id),
		/** The currently bound version. */
		definitionVersionId: uuid('definition_version_id')
			.notNull()
			.references(() => definitionVersions.id),
		/** Pinned cases move only by an explicit, recorded move; following cases track new versions. */
		binding: caseBinding('binding').notNull(),
		title: text('title').notNull(),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		unique('cases_id_namespace_key').on(t.id, t.namespaceId),
		index('cases_definition_version_id_idx').on(t.definitionVersionId)
	]
);

/** Audit of explicit moves of a pinned case to another version (ADR 0016). */
export const caseVersionMoves = pgTable(
	'case_version_moves',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		caseId: uuid('case_id')
			.notNull()
			.references(() => cases.id, { onDelete: 'cascade' }),
		fromVersionId: uuid('from_version_id')
			.notNull()
			.references(() => definitionVersions.id),
		toVersionId: uuid('to_version_id')
			.notNull()
			.references(() => definitionVersions.id),
		movedById: uuid('moved_by_id')
			.notNull()
			.references(() => principals.id),
		movedAt: timestamp('moved_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [index('case_version_moves_case_id_idx').on(t.caseId)]
);

/**
 * Zanzibar-style `(principal, role, scope)` tuples (ADR 0008, ADR 0015).
 *
 * The scope is an account, a namespace in it, or a case in that namespace. Every binding carries
 * its account, a namespace binding its namespace (ADR 0007), and a case binding both, with
 * composite foreign keys keeping case, namespace and account consistent. `scope_type` and
 * `scope_id` are derived so the tuple shape stays explicit. Account scope holds the built-in
 * account roles; namespace scope holds the built-in namespace permissions and standing process
 * roles; case scope holds process roles. The partial indexes serve resolution in the order case,
 * then namespace lineage, then account.
 */
export const roleBindings = pgTable(
	'role_bindings',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		principalId: uuid('principal_id')
			.notNull()
			.references(() => principals.id, { onDelete: 'cascade' }),
		role: text('role').notNull(),
		accountId: uuid('account_id')
			.notNull()
			.references(() => accounts.id),
		namespaceId: uuid('namespace_id'),
		caseId: uuid('case_id'),
		scopeType: text('scope_type')
			.notNull()
			.generatedAlwaysAs(
				sql`CASE WHEN case_id IS NOT NULL THEN 'case' WHEN namespace_id IS NOT NULL THEN 'namespace' ELSE 'account' END`
			),
		scopeId: uuid('scope_id')
			.notNull()
			.generatedAlwaysAs(sql`COALESCE(case_id, namespace_id, account_id)`),
		createdAt: createdAt()
	},
	(t) => [
		foreignKey({
			name: 'role_bindings_namespace_fk',
			columns: [t.namespaceId, t.accountId],
			foreignColumns: [namespaces.id, namespaces.accountId]
		}),
		foreignKey({
			name: 'role_bindings_case_fk',
			columns: [t.caseId, t.namespaceId],
			foreignColumns: [cases.id, cases.namespaceId]
		})
			.onDelete('cascade')
			.onUpdate('cascade'),
		check(
			'role_bindings_case_has_namespace',
			sql`${t.caseId} IS NULL OR ${t.namespaceId} IS NOT NULL`
		),
		uniqueIndex('role_bindings_tuple_key').on(t.principalId, t.role, t.scopeType, t.scopeId),
		index('role_bindings_case_role_idx')
			.on(t.caseId, t.role)
			.where(sql`${t.caseId} IS NOT NULL`),
		index('role_bindings_namespace_role_idx')
			.on(t.namespaceId, t.role)
			.where(sql`${t.caseId} IS NULL AND ${t.namespaceId} IS NOT NULL`),
		index('role_bindings_account_role_idx')
			.on(t.accountId, t.role)
			.where(sql`${t.namespaceId} IS NULL`),
		index('role_bindings_principal_id_idx').on(t.principalId)
	]
);

/**
 * A user's expiring grant letting an agent act on their behalf (ADR 0009), optionally limited
 * to a namespace, a case (which implies its namespace) and a role.
 */
export const delegationGrants = pgTable(
	'delegation_grants',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		delegatorId: uuid('delegator_id').notNull(),
		delegatorKind: principalKind('delegator_kind').notNull().default('user'),
		agentId: uuid('agent_id').notNull(),
		agentKind: principalKind('agent_kind').notNull().default('agent'),
		namespaceId: uuid('namespace_id').references(() => namespaces.id),
		caseId: uuid('case_id'),
		role: text('role'),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		revokedAt: timestamp('revoked_at', { withTimezone: true }),
		createdAt: createdAt()
	},
	(t) => [
		foreignKey({
			name: 'delegation_grants_delegator_fk',
			columns: [t.delegatorId, t.delegatorKind],
			foreignColumns: [principals.id, principals.kind]
		}).onDelete('cascade'),
		foreignKey({
			name: 'delegation_grants_agent_fk',
			columns: [t.agentId, t.agentKind],
			foreignColumns: [principals.id, principals.kind]
		}).onDelete('cascade'),
		foreignKey({
			name: 'delegation_grants_case_fk',
			columns: [t.caseId, t.namespaceId],
			foreignColumns: [cases.id, cases.namespaceId]
		})
			.onDelete('cascade')
			.onUpdate('cascade'),
		index('delegation_grants_agent_active_idx')
			.on(t.agentId)
			.where(sql`${t.revokedAt} IS NULL`),
		index('delegation_grants_delegator_id_idx').on(t.delegatorId),
		check('delegation_grants_delegator_kind_user', sql`${t.delegatorKind} = 'user'`),
		check('delegation_grants_agent_kind_agent', sql`${t.agentKind} = 'agent'`),
		check(
			'delegation_grants_case_has_namespace',
			sql`${t.caseId} IS NULL OR ${t.namespaceId} IS NOT NULL`
		)
	]
);
