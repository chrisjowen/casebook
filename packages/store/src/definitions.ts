// Definition editing over the repository: reading each definition with its draft and published
// version, and recording node operations, undo and publish under its change policy (ADR 0016,
// ADR 0018, ADR 0019). `@casebook/model` decides what an edit or a publish does; the repository
// stores it and checks the actor with `can` (ADR 0017). Expected refusals, such as a missing
// permission, a rejected operation or a failing publish check, come back as a `Refusal` with a
// plain-language reason rather than as an exception.
import { createHash } from 'node:crypto';
import { asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
	checkPublish,
	commit,
	diff,
	publish,
	SCHEMA_VERSION,
	startHistory,
	undo,
	type Attribution,
	type Change,
	type CommitResult,
	type DefinitionDocument,
	type InvariantIssue,
	type Operation,
	type PublishCheck,
	type PublishDecision,
	type PublishedVersion,
	type PublishRefusalCode,
	type RejectionCode,
	type Revision,
	type SourceRef,
	type ValidationError
} from '@casebook/model';
import { can, type Action, type Actor, type Decision, type Resource } from './authz.js';
import type { Db } from './client.js';
import {
	AccessDeniedError,
	appendDraftRevision,
	createProcessDefinition,
	publishVersion,
	StoreRuleError,
	type ChangePolicy,
	type PrincipalKind
} from './repository.js';
import {
	accounts,
	definitionVersions,
	draftRevisions,
	groupMembers,
	namespaces,
	principals,
	processDefinitions,
	roleBindings
} from './schema.js';

export type RefusalCode =
	'access-denied' | 'not-found' | 'stale-draft' | RejectionCode | PublishRefusalCode;

/** Why an edit, undo, publish or create was not done. Nothing was written. */
export interface Refusal {
	ok: false;
	code: RefusalCode;
	reason: string;
	/** Schema violations, for a refused publish or operation. */
	errors: ValidationError[];
	/** Invariant issues, such as the publish checks that failed. */
	issues: InvariantIssue[];
}

/** A namespace as the editor lists it. */
export interface NamespaceRef {
	id: string;
	accountId: string;
	accountSlug: string;
	path: string;
}

/** The newest draft revision of a definition. */
export interface DraftHead {
	id: string;
	number: number;
	/** Its `version` is the one a publish would make, or the latest when nothing changed. */
	document: DefinitionDocument;
	createdAt: Date;
	authorName: string;
	/** True when an undo has an earlier revision to go back to. */
	undoable: boolean;
}

/** The latest published version of a definition. */
export interface LatestVersion {
	version: number;
	/** Its `version` field is the version number. */
	document: DefinitionDocument;
	publishedAt: Date;
	publishedByName: string;
}

export interface DefinitionState {
	id: string;
	namespace: NamespaceRef;
	slug: string;
	changePolicy: ChangePolicy;
	publishRequiresApproval: boolean;
	draft?: DraftHead;
	published?: LatestVersion;
	/** What the draft changes since the latest published version; empty when nothing does. */
	changes: Change[];
	/** The publish checks on the draft, or on the published version when there is no draft. */
	check: PublishCheck;
}

/** A definition with what the actor may do to it. */
export interface DefinitionForActor extends DefinitionState {
	can: { edit: Decision; publish: Decision };
}

/** A namespace the actor can read, with its definitions and whether they may add one. */
export interface NamespaceForActor {
	namespace: NamespaceRef;
	can: { create: Decision };
	definitions: DefinitionForActor[];
}

/**
 * Every namespace `actor` may read definitions in, ordered by path, with its definitions and
 * the actor's permissions on each. Namespaces the actor cannot read are left out.
 */
export async function listDefinitions(db: Db, actor: Actor): Promise<NamespaceForActor[]> {
	// Bindings never apply outside their account, so only accounts where the actor, the principal
	// it acts for, or one of their groups holds a role can have anything for it to read.
	const ids = [actor.id, ...(actor.onBehalfOfId === undefined ? [] : [actor.onBehalfOfId])];
	const memberships = await db.execute<{ account_id: string }>(sql`
		WITH RECURSIVE subjects(id) AS (
			SELECT id FROM ${principals} WHERE id IN ${ids}
			UNION
			SELECT gm.group_id FROM ${groupMembers} gm JOIN subjects s ON gm.member_id = s.id
		)
		SELECT DISTINCT account_id FROM ${roleBindings}
		WHERE principal_id IN (SELECT id FROM subjects)`);
	const accountIds = [...memberships].map((m) => m.account_id);
	if (accountIds.length === 0) return [];
	const rows = await db
		.select({
			id: namespaces.id,
			accountId: namespaces.accountId,
			accountSlug: accounts.slug,
			path: namespaces.path
		})
		.from(namespaces)
		.innerJoin(accounts, eq(accounts.id, namespaces.accountId))
		.where(inArray(namespaces.accountId, accountIds))
		.orderBy(asc(accounts.slug), asc(namespaces.path));

	const result: NamespaceForActor[] = [];
	for (const namespace of rows) {
		const resource = { type: 'namespace', namespaceId: namespace.id } as const;
		if (!(await can(db, actor, 'definition.read', resource)).allowed) continue;
		const ids = await db
			.select({ id: processDefinitions.id })
			.from(processDefinitions)
			.where(eq(processDefinitions.namespaceId, namespace.id))
			.orderBy(asc(processDefinitions.slug));
		const definitions: DefinitionForActor[] = [];
		for (const { id } of ids) {
			const state = await loadDefinition(db, id);
			if (!state) continue;
			const definition = { type: 'definition', definitionId: id } as const;
			definitions.push({
				...state,
				can: {
					edit: await can(db, actor, 'definition.edit', definition),
					publish: await can(db, actor, 'definition.publish', definition)
				}
			});
		}
		result.push({
			namespace,
			can: { create: await can(db, actor, 'definition.create', resource) },
			definitions
		});
	}
	return result;
}

/** A definition with its draft head, latest version, changes and checks, if it exists. */
export async function loadDefinition(
	db: Db,
	definitionId: string
): Promise<DefinitionState | undefined> {
	const stored = await loadStored(db, definitionId);
	if (!stored) return undefined;
	const { definition, head, latest } = stored;
	const published = latest && {
		version: latest.version,
		document: { ...latest.body, version: latest.version },
		publishedAt: latest.publishedAt,
		publishedByName: latest.publishedByName
	};
	const changes =
		head === undefined
			? []
			: diff(
					{ ...(latest?.body ?? emptyLike(head.body)), version: 0 },
					{ ...head.body, version: 0 }
				);
	const draft: DraftHead | undefined = head && {
		id: head.id,
		number: head.revision,
		document: {
			...head.body,
			version: (latest?.version ?? 0) + (latest && changes.length === 0 ? 0 : 1)
		},
		createdAt: head.createdAt,
		authorName: head.authorName,
		undoable: (head.revertedTo ?? head.revision) > 1
	};
	return {
		id: definition.id,
		namespace: definition.namespace,
		slug: definition.slug,
		changePolicy: definition.changePolicy,
		publishRequiresApproval: definition.publishRequiresApproval,
		...(draft ? { draft } : {}),
		...(published ? { published } : {}),
		changes,
		check: checkPublish((draft ?? published)?.document ?? emptyLike(undefined))
	};
}

// Writes

export interface NewDefinition {
	namespaceId: string;
	/** The process title; the slug is made from it, numbered when already taken. */
	title: string;
	changePolicy?: ChangePolicy;
	/**
	 * Start from the process node alone instead of the starter stage, role and step, for a draft
	 * that something else builds, such as the wizard agent.
	 */
	blank?: boolean;
	/** Where the process came from, recorded on its process node. */
	source?: SourceRef;
}

export interface Created {
	ok: true;
	definitionId: string;
	slug: string;
	/** The version made straight away for a living definition. */
	version?: number;
}

/**
 * Creates a definition in a namespace with a starter draft: the process, one stage, one role and
 * one step, for the editor to build on, or the process alone when `blank`. The actor needs `definition.create` on the namespace and
 * becomes the definition's creator; the principal they act for, or they themselves, its owner.
 * A living definition publishes the starter draft as version 1 straight away.
 */
export async function createDefinition(
	db: Db,
	actor: Actor,
	input: NewDefinition
): Promise<Created | Refusal> {
	const denied = await permission(db, actor, 'definition.create', {
		type: 'namespace',
		namespaceId: input.namespaceId
	});
	if (denied) return denied;
	const [namespace] = await db
		.select({ path: namespaces.path })
		.from(namespaces)
		.where(eq(namespaces.id, input.namespaceId));
	if (!namespace) return refuse('not-found', `namespace ${input.namespaceId} does not exist`);

	const title = input.title.trim() || 'New process';
	const slug = await freeSlug(db, input.namespaceId, slugify(title));
	const document = starterDocument(namespace.path, slug, title, input);
	const attribution = await attributionOf(db, actor);
	const started = startHistory(document, attribution);
	if (!started.ok) return refusal(started);

	try {
		const definition = await createProcessDefinition(
			db,
			{
				namespaceId: input.namespaceId,
				slug,
				ownerId: actor.onBehalfOfId ?? actor.id,
				createdById: actor.id,
				changePolicy: input.changePolicy ?? 'governed'
			},
			{ actor }
		);
		const recorded = await record(db, actor, definition.id, definition.changePolicy, started);
		if (!recorded.ok) return recorded;
		return {
			ok: true,
			definitionId: definition.id,
			slug,
			...(recorded.version === undefined ? {} : { version: recorded.version })
		};
	} catch (error) {
		return storeRefusal(error);
	}
}

export interface DefinitionEdit {
	definitionId: string;
	/** Node operations, applied as one atomic edit. Checked by the model, so any JSON will do. */
	ops: unknown[];
	/** The draft revision the edit was made against; a newer head refuses it as stale. */
	baseRevision: number;
}

export interface Edited {
	ok: true;
	/** The new draft revision. */
	revision: number;
	/** Draft incompleteness the edit leaves, which blocks only a governed publish. */
	warnings: InvariantIssue[];
	/** The version a living definition published from the edit. */
	version?: number;
}

/**
 * Applies node operations to a definition's draft as the next revision. The actor needs
 * `definition.edit`, and `definition.publish` too when the definition is living, since each of
 * its edits is published as a new version.
 */
export async function editDefinition(
	db: Db,
	actor: Actor,
	input: DefinitionEdit
): Promise<Edited | Refusal> {
	const stored = await loadStored(db, input.definitionId);
	if (!stored) return notFound(input.definitionId);
	const denied = await editPermission(db, actor, input.definitionId, stored.definition);
	if (denied) return denied;
	const head = headRevision(stored);
	if (!head) return refuse('unknown-revision', `${stored.definition.slug} has no draft to edit`);
	if (head.number !== input.baseRevision) return stale(head.number, input.baseRevision);
	const attribution = await attributionOf(db, actor);
	const result = commit(head, input.ops as Operation[], attribution);
	return record(db, actor, input.definitionId, stored.definition.changePolicy, result, stored);
}

/** A definition's draft head, as an actor who may read it sees it. */
export interface DraftRead {
	ok: true;
	/** The head revision's number; 0 for a definition published without a draft. */
	revision: number;
	document: DefinitionDocument;
}

/** Reads a definition's draft head, or its latest version when it has no draft. */
export async function readDraft(
	db: Db,
	actor: Actor,
	definitionId: string
): Promise<DraftRead | Refusal> {
	const stored = await loadStored(db, definitionId);
	if (!stored) return notFound(definitionId);
	const denied = await permission(db, actor, 'definition.read', {
		type: 'definition',
		definitionId
	});
	if (denied) return denied;
	const head = headRevision(stored);
	if (!head) return refuse('unknown-revision', `${stored.definition.slug} has no draft`);
	return { ok: true, revision: head.number, document: head.document };
}

export interface EditPreview {
	ok: true;
	/** The draft revision the edit was checked against. */
	revision: number;
	/** The draft as the edit would leave it. */
	document: DefinitionDocument;
	/** What the edit changes in the draft. */
	changes: Change[];
	/** Draft incompleteness the edit would leave, which blocks only a governed publish. */
	warnings: InvariantIssue[];
}

/**
 * Checks node operations as an edit of a definition's draft without saving them: the same
 * permission, staleness and model checks as `editDefinition`, so an edit that previews can be
 * saved unchanged against the same revision. Proposals, such as a wizard agent's turn, are
 * reviewed this way before anyone accepts them.
 */
export async function previewDefinitionEdit(
	db: Db,
	actor: Actor,
	input: DefinitionEdit
): Promise<EditPreview | Refusal> {
	const stored = await loadStored(db, input.definitionId);
	if (!stored) return notFound(input.definitionId);
	const denied = await editPermission(db, actor, input.definitionId, stored.definition);
	if (denied) return denied;
	const head = headRevision(stored);
	if (!head) return refuse('unknown-revision', `${stored.definition.slug} has no draft to edit`);
	if (head.number !== input.baseRevision) return stale(head.number, input.baseRevision);
	const result = commit(head, input.ops as Operation[], await attributionOf(db, actor));
	if (!result.ok) return refusal(result);
	return {
		ok: true,
		revision: head.number,
		document: result.revision.document,
		changes: diff(head.document, result.revision.document),
		warnings: result.warnings
	};
}

/** Undoes the latest edit of a definition's draft, as a new revision. Needs what an edit does. */
export async function undoDefinitionEdit(
	db: Db,
	actor: Actor,
	input: Omit<DefinitionEdit, 'ops'>
): Promise<Edited | Refusal> {
	const stored = await loadStored(db, input.definitionId);
	if (!stored) return notFound(input.definitionId);
	const denied = await editPermission(db, actor, input.definitionId, stored.definition);
	if (denied) return denied;
	const history = await revisionsOf(db, input.definitionId);
	const headNumber = history.at(-1)?.number ?? 0;
	if (headNumber !== input.baseRevision) return stale(headNumber, input.baseRevision);
	const result = undo(history, await attributionOf(db, actor));
	return record(db, actor, input.definitionId, stored.definition.changePolicy, result, stored);
}

export interface Published {
	ok: true;
	version: number;
	/** Warnings the publish checks recorded on the version. */
	issues: InvariantIssue[];
}

/**
 * Publishes a governed definition's draft head as its next version. The actor needs
 * `definition.publish`, and the publish checks must pass (ADR 0005). A living definition is
 * refused: each of its edits is already published. A definition whose policy requires approval
 * is refused until the approval flow exists. A draft head newer than `baseRevision` is refused as
 * stale, so only the revision the actor reviewed is published.
 */
export async function publishDefinition(
	db: Db,
	actor: Actor,
	input: Omit<DefinitionEdit, 'ops'>
): Promise<Published | Refusal> {
	const stored = await loadStored(db, input.definitionId);
	if (!stored) return notFound(input.definitionId);
	const resource = { type: 'definition', definitionId: input.definitionId } as const;
	const denied = await permission(db, actor, 'definition.publish', resource);
	if (denied) return denied;
	const { definition, head, latest } = stored;
	if (definition.changePolicy === 'living') {
		return refuse('no-change', 'This is a living definition: every edit is already published');
	}
	if (!head) return refuse('unknown-revision', `${definition.slug} has no draft to publish`);
	if (head.revision !== input.baseRevision) return stale(head.revision, input.baseRevision);
	const attribution = await attributionOf(db, actor);
	const decision = publish({
		policy: { mode: 'governed', requiresApproval: definition.publishRequiresApproval },
		document: head.body,
		revision: head.revision,
		...(latest ? { latest: publishedVersion(latest, 'governed') } : {}),
		publishedBy: attribution.author,
		...(attribution.onBehalfOf ? { onBehalfOf: attribution.onBehalfOf } : {})
	});
	if (!decision.allowed) return refusal(decision);
	try {
		const version = await publishVersion(
			db,
			{
				definitionId: input.definitionId,
				sourceRevisionId: head.id,
				authorId: head.authorId,
				publishedById: actor.id,
				schemaVersion: String(head.body.schemaVersion),
				contentHash: contentHash(head.body)
			},
			{ actor }
		);
		return { ok: true, version: version.version, issues: decision.version.issues };
	} catch (error) {
		return storeRefusal(error);
	}
}

/** A stable hash of a definition body: SHA-256 of its JSON with object keys sorted. */
export function contentHash(body: unknown): string {
	return createHash('sha256').update(canonicalJson(body)).digest('hex');
}

// Internals

interface StoredDefinition {
	definition: {
		id: string;
		slug: string;
		changePolicy: ChangePolicy;
		publishRequiresApproval: boolean;
		namespace: NamespaceRef;
	};
	head?: {
		id: string;
		revision: number;
		body: DefinitionDocument;
		ops: Operation[];
		revertedTo: number | null;
		authorId: string;
		authorKind: PrincipalKind;
		authorName: string;
		createdAt: Date;
	};
	latest?: {
		version: number;
		body: DefinitionDocument;
		sourceRevision: number | null;
		publishedById: string;
		publishedByKind: PrincipalKind;
		publishedByName: string;
		publishedAt: Date;
	};
}

async function loadStored(db: Db, definitionId: string): Promise<StoredDefinition | undefined> {
	const [definition] = await db
		.select({
			id: processDefinitions.id,
			slug: processDefinitions.slug,
			changePolicy: processDefinitions.changePolicy,
			publishRequiresApproval: processDefinitions.publishRequiresApproval,
			namespace: {
				id: namespaces.id,
				accountId: namespaces.accountId,
				accountSlug: accounts.slug,
				path: namespaces.path
			}
		})
		.from(processDefinitions)
		.innerJoin(namespaces, eq(namespaces.id, processDefinitions.namespaceId))
		.innerJoin(accounts, eq(accounts.id, namespaces.accountId))
		.where(eq(processDefinitions.id, definitionId));
	if (!definition) return undefined;

	const [head] = await db
		.select({
			id: draftRevisions.id,
			revision: draftRevisions.revision,
			body: draftRevisions.body,
			ops: draftRevisions.ops,
			revertedTo: draftRevisions.revertedTo,
			authorId: draftRevisions.authorId,
			authorKind: draftRevisions.authorKind,
			authorName: principals.displayName,
			createdAt: draftRevisions.createdAt
		})
		.from(draftRevisions)
		.innerJoin(principals, eq(principals.id, draftRevisions.authorId))
		.where(eq(draftRevisions.definitionId, definitionId))
		.orderBy(desc(draftRevisions.revision))
		.limit(1);

	const [latest] = await db
		.select({
			version: definitionVersions.version,
			body: definitionVersions.body,
			sourceRevision: draftRevisions.revision,
			publishedById: definitionVersions.publishedById,
			publishedByKind: principals.kind,
			publishedByName: principals.displayName,
			publishedAt: definitionVersions.publishedAt
		})
		.from(definitionVersions)
		.innerJoin(principals, eq(principals.id, definitionVersions.publishedById))
		.leftJoin(draftRevisions, eq(draftRevisions.id, definitionVersions.sourceRevisionId))
		.where(eq(definitionVersions.definitionId, definitionId))
		.orderBy(desc(definitionVersions.version))
		.limit(1);

	return {
		definition,
		...(head
			? {
					head: {
						...head,
						body: head.body as DefinitionDocument,
						ops: head.ops as Operation[]
					}
				}
			: {}),
		...(latest ? { latest: { ...latest, body: latest.body as DefinitionDocument } } : {})
	};
}

/** The draft head as a model revision; a definition published without a draft starts at 0. */
function headRevision({ head, latest }: StoredDefinition): Revision | undefined {
	if (head) {
		return {
			number: head.revision,
			document: head.body,
			ops: head.ops,
			author: { id: head.authorId, kind: head.authorKind },
			createdAt: head.createdAt.toISOString(),
			...(head.revertedTo === null ? {} : { revertedTo: head.revertedTo })
		};
	}
	if (latest) {
		return {
			number: 0,
			document: latest.body,
			ops: [],
			author: { id: latest.publishedById, kind: latest.publishedByKind },
			createdAt: latest.publishedAt.toISOString()
		};
	}
	return undefined;
}

async function revisionsOf(db: Db, definitionId: string): Promise<Revision[]> {
	const rows = await db
		.select({
			revision: draftRevisions.revision,
			body: draftRevisions.body,
			ops: draftRevisions.ops,
			revertedTo: draftRevisions.revertedTo,
			authorId: draftRevisions.authorId,
			authorKind: draftRevisions.authorKind,
			onBehalfOfId: draftRevisions.onBehalfOfId,
			onBehalfOfKind: draftRevisions.onBehalfOfKind,
			createdAt: draftRevisions.createdAt
		})
		.from(draftRevisions)
		.where(eq(draftRevisions.definitionId, definitionId))
		.orderBy(asc(draftRevisions.revision));
	return rows.map((r) => ({
		number: r.revision,
		document: r.body as DefinitionDocument,
		ops: r.ops as Operation[],
		author: { id: r.authorId, kind: r.authorKind },
		...(r.onBehalfOfId !== null && r.onBehalfOfKind !== null
			? { onBehalfOf: { id: r.onBehalfOfId, kind: r.onBehalfOfKind } }
			: {}),
		createdAt: r.createdAt.toISOString(),
		...(r.revertedTo === null ? {} : { revertedTo: r.revertedTo })
	}));
}

function publishedVersion(
	latest: NonNullable<StoredDefinition['latest']>,
	policy: ChangePolicy
): PublishedVersion {
	return {
		version: latest.version,
		document: { ...latest.body, version: latest.version },
		policy,
		...(latest.sourceRevision === null ? {} : { revision: latest.sourceRevision }),
		publishedBy: { id: latest.publishedById, kind: latest.publishedByKind },
		publishedAt: latest.publishedAt.toISOString(),
		issues: []
	};
}

/**
 * Stores a committed revision. A living definition's revision is published as a new version in
 * the same write, after the model's publish decides it may be.
 */
async function record(
	db: Db,
	actor: Actor,
	definitionId: string,
	policy: ChangePolicy,
	result: CommitResult,
	stored?: StoredDefinition
): Promise<Edited | Refusal> {
	if (!result.ok) return refusal(result);
	const { revision } = result;
	let decision: PublishDecision | undefined;
	if (policy === 'living') {
		decision = publish({
			policy: { mode: 'living' },
			document: revision.document,
			revision: revision.number,
			...(stored?.latest ? { latest: publishedVersion(stored.latest, 'living') } : {}),
			publishedBy: revision.author,
			...(revision.onBehalfOf ? { onBehalfOf: revision.onBehalfOf } : {})
		});
		if (!decision.allowed) return refusal(decision);
	}
	try {
		const { revision: row, version } = await appendDraftRevision(
			db,
			{
				definitionId,
				body: revision.document,
				ops: revision.ops,
				...(revision.revertedTo === undefined ? {} : { revertedTo: revision.revertedTo }),
				revision: revision.number,
				authorId: actor.id,
				...(actor.onBehalfOfId === undefined ? {} : { onBehalfOfId: actor.onBehalfOfId }),
				...(decision
					? {
							publish: {
								schemaVersion: String(revision.document.schemaVersion),
								contentHash: contentHash(revision.document)
							}
						}
					: {})
			},
			{ actor }
		);
		return {
			ok: true,
			revision: row.revision,
			warnings: result.warnings,
			...(version ? { version: version.version } : {})
		};
	} catch (error) {
		return storeRefusal(error);
	}
}

async function editPermission(
	db: Db,
	actor: Actor,
	definitionId: string,
	definition: StoredDefinition['definition']
): Promise<Refusal | undefined> {
	const resource = { type: 'definition', definitionId } as const;
	return (
		(await permission(db, actor, 'definition.edit', resource)) ??
		(definition.changePolicy === 'living'
			? await permission(db, actor, 'definition.publish', resource)
			: undefined)
	);
}

async function permission(
	db: Db,
	actor: Actor,
	action: Action,
	resource: Resource
): Promise<Refusal | undefined> {
	const decision = await can(db, actor, action, resource);
	return decision.allowed ? undefined : refuse('access-denied', decision.reason);
}

/** How the model records the actor: a user acts for themselves; others record who they act for. */
async function attributionOf(db: Db, actor: Actor): Promise<Attribution> {
	const ids = [actor.id, ...(actor.onBehalfOfId === undefined ? [] : [actor.onBehalfOfId])];
	const rows = await db
		.select({ id: principals.id, kind: principals.kind })
		.from(principals)
		.where(inArray(principals.id, ids));
	const kindOf = (id: string) => rows.find((r) => r.id === id)?.kind ?? 'user';
	return {
		author: { id: actor.id, kind: kindOf(actor.id) },
		...(actor.onBehalfOfId === undefined
			? {}
			: { onBehalfOf: { id: actor.onBehalfOfId, kind: kindOf(actor.onBehalfOfId) } })
	};
}

/** A first draft to build on: the process, then one stage, one role and one step unless blank. */
function starterDocument(
	namespace: string,
	slug: string,
	title: string,
	{ blank, source }: Pick<NewDefinition, 'blank' | 'source'>
): DefinitionDocument {
	const process = {
		core: { id: `process.${slug}`, kind: 'process', title, ...(source ? { source } : {}) }
	} as const;
	if (blank)
		return { schemaVersion: SCHEMA_VERSION, namespace, slug, version: 1, nodes: [process] };
	return {
		schemaVersion: SCHEMA_VERSION,
		namespace,
		slug,
		version: 1,
		nodes: [
			process,
			{ core: { id: 'stage.start', kind: 'stage', title: 'Start' } },
			{ core: { id: 'role.owner', kind: 'role', title: 'Owner', scope: 'namespace' } },
			{
				core: {
					id: 'step.first-step',
					kind: 'step',
					title: 'First step',
					stage: 'stage.start',
					role: 'role.owner',
					actor: 'human'
				}
			}
		]
	};
}

function emptyLike(document: DefinitionDocument | undefined): DefinitionDocument {
	return {
		schemaVersion: SCHEMA_VERSION,
		namespace: document?.namespace ?? '',
		slug: document?.slug ?? '',
		version: 0,
		nodes: []
	};
}

/** "Incident review (EU)" becomes "incident-review-eu". */
function slugify(title: string): string {
	return (
		title
			.normalize('NFKD')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '') || 'process'
	);
}

async function freeSlug(db: Db, namespaceId: string, base: string): Promise<string> {
	const taken = new Set(
		(
			await db
				.select({ slug: processDefinitions.slug })
				.from(processDefinitions)
				.where(eq(processDefinitions.namespaceId, namespaceId))
		).map((r) => r.slug)
	);
	let slug = base;
	for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
	return slug;
}

function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	if (typeof value === 'object' && value !== null) {
		const entries = Object.entries(value)
			.filter(([, v]) => v !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
		return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
	}
	return JSON.stringify(value);
}

function refusal(result: {
	code: RefusalCode;
	reason: string;
	errors: ValidationError[];
	issues: InvariantIssue[];
}): Refusal {
	return {
		ok: false,
		code: result.code,
		reason: result.reason,
		errors: result.errors,
		issues: result.issues
	};
}

function refuse(code: RefusalCode, reason: string): Refusal {
	return { ok: false, code, reason, errors: [], issues: [] };
}

const notFound = (definitionId: string) =>
	refuse('not-found', `definition ${definitionId} does not exist`);

const stale = (head: number, base: number) =>
	refuse(
		'stale-draft',
		`The draft changed while you were editing (revision ${head}, not ${base}); reload to see the latest`
	);

/** Turns the repository's refusals of a write into a `Refusal`; anything else is rethrown. */
function storeRefusal(error: unknown): Refusal {
	if (error instanceof AccessDeniedError) return refuse('access-denied', error.reason);
	if (error instanceof StoreRuleError) {
		if (error.rule === 'revision-conflict') {
			return refuse(
				'stale-draft',
				'Someone else edited the draft at the same time; reload to see the latest'
			);
		}
		if (error.rule === 'revision-already-published') {
			return refuse('no-change', 'Someone else published this draft at the same time');
		}
		if (error.rule === 'definition-missing') return refuse('not-found', error.message);
	}
	throw error;
}
