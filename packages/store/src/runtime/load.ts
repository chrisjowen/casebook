// Loads cases with everything the runtime needs to work out where they stand: their attached
// processes and versions, the event log, the recorded facts and files, and who holds each process
// role on them. `@casebook/model` does the evaluation; this file only reads.
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
	evaluateProcess,
	foldConversation,
	foldProgress,
	ITEM_EVENTS,
	runnableProcess,
	type Conversation,
	type DefinitionDocument,
	type ItemEvent,
	type ProcessState,
	type RunnableProcess,
	type SharedLookups
} from '@casebook/model';
import { ACCOUNT_ROLES, NAMESPACE_PERMISSIONS, namespacePathPrefixes } from '../authz.js';
import type { Queryable } from '../client.js';
import { sharedLookupsAlong } from '../lookups.js';
import type { CaseBinding, PrincipalKind } from '../repository.js';
import {
	accounts,
	caseAttachments,
	caseEvents,
	caseFacts,
	caseFiles,
	cases,
	definitionVersions,
	groupMembers,
	namespaces,
	principals,
	processDefinitions,
	roleBindings
} from '../schema.js';

/** A principal as the runtime names it. */
export interface Person {
	id: string;
	name: string;
	kind: PrincipalKind;
}

/** A value recorded on a case, with who recorded it, when, and from which work item. */
export interface FactRecord {
	fact: string;
	value: unknown;
	at: Date;
	by: string;
	onBehalfOf?: string;
	attachmentId?: string;
	item?: string;
}

export interface FileRecord {
	id: string;
	fact?: string;
	evidence?: string;
	name: string;
	contentType: string;
	size: number;
	storageKey: string;
	at: Date;
	by: string;
	onBehalfOf?: string;
	attachmentId?: string;
	item?: string;
}

/** One event of the case log, as the runtime reads it back. */
export interface EventRecord {
	seq: number;
	type: string;
	attachmentId?: string;
	item?: string;
	by: string;
	onBehalfOf?: string;
	data: Record<string, unknown>;
	at: Date;
}

export interface LoadedAttachment {
	id: string;
	caseId: string;
	definitionId: string;
	definitionSlug: string;
	/** The definition's namespace. */
	namespace: string;
	versionId: string;
	version: number;
	/** The definition's latest published version, which a pinned attachment may be behind. */
	latestVersion: number;
	binding: CaseBinding;
	label?: string;
	startedBy?: string;
	createdAt: Date;
	completedAt?: Date;
	document: DefinitionDocument;
	process: RunnableProcess;
	/** The shared lookups its facts can choose from, seen from the definition's namespace. */
	shared: SharedLookups;
	state: ProcessState;
	/** The principals who hold each process role on the case, groups expanded to their members. */
	holders: Map<string, string[]>;
	/** Its work-item events, oldest first. */
	events: EventRecord[];
	/** Its items' saved drafts and questions (ADR 0026). */
	conversation: Conversation;
}

export interface LoadedCase {
	id: string;
	title: string;
	subject?: string;
	namespaceId: string;
	namespace: string;
	accountId: string;
	accountSlug: string;
	accountName: string;
	openedBy?: string;
	createdAt: Date;
	/** The current value of each fact, by fact id: its newest record. */
	facts: Map<string, FactRecord>;
	/** Every fact record, oldest first. */
	history: FactRecord[];
	files: FileRecord[];
	attachments: LoadedAttachment[];
	/** The case's whole event log, oldest first. */
	events: EventRecord[];
}

export interface Loaded {
	cases: LoadedCase[];
	/** Everyone the cases mention: holders, actors and principals recorded as fact values. */
	people: Map<string, Person>;
}

const BUILT_IN_ROLES: readonly string[] = [...ACCOUNT_ROLES, ...NAMESPACE_PERMISSIONS];
const ITEM_EVENT_TYPES: ReadonlySet<string> = new Set(ITEM_EVENTS);

/** The ids of the cases in an account, newest first. */
export async function caseIdsInAccount(db: Queryable, accountId: string): Promise<string[]> {
	const rows = await db
		.select({ id: cases.id })
		.from(cases)
		.innerJoin(namespaces, eq(namespaces.id, cases.namespaceId))
		.where(eq(namespaces.accountId, accountId))
		.orderBy(desc(cases.createdAt));
	return rows.map((r) => r.id);
}

/**
 * The IANA time zone `CASEBOOK_TIMEZONE` names, such as `Asia/Singapore`, which conditions count
 * calendar days in; UTC when it is unset.
 */
export function conditionTimeZone(env: NodeJS.ProcessEnv = process.env): string {
	const zone = env.CASEBOOK_TIMEZONE?.trim() || 'UTC';
	try {
		new Intl.DateTimeFormat('en', { timeZone: zone });
	} catch {
		throw new Error(`CASEBOOK_TIMEZONE is not a time zone: ${zone}`);
	}
	return zone;
}

/**
 * Loads the cases with these ids, in the order given, and evaluates every process attached to
 * them at `now`, counting days in the `conditionTimeZone`. Ids that name no case are left out.
 */
export async function loadCases(db: Queryable, caseIds: string[], now: Date): Promise<Loaded> {
	if (caseIds.length === 0) return { cases: [], people: new Map() };
	const timeZone = conditionTimeZone();
	const caseRows = await db
		.select({
			id: cases.id,
			title: cases.title,
			subject: cases.subject,
			namespaceId: cases.namespaceId,
			namespace: namespaces.path,
			accountId: namespaces.accountId,
			accountSlug: accounts.slug,
			accountName: accounts.displayName,
			openedBy: cases.openedById,
			createdAt: cases.createdAt
		})
		.from(cases)
		.innerJoin(namespaces, eq(namespaces.id, cases.namespaceId))
		.innerJoin(accounts, eq(accounts.id, namespaces.accountId))
		.where(inArray(cases.id, caseIds));
	const ids = caseRows.map((c) => c.id);
	if (ids.length === 0) return { cases: [], people: new Map() };

	const latest = db
		.select({
			definitionId: definitionVersions.definitionId,
			version: sql<number>`max(${definitionVersions.version})`.as('latest_version')
		})
		.from(definitionVersions)
		.where(eq(definitionVersions.status, 'published'))
		.groupBy(definitionVersions.definitionId)
		.as('latest');
	const [attachmentRows, eventRows, factRows, fileRows] = await Promise.all([
		db
			.select({
				id: caseAttachments.id,
				caseId: caseAttachments.caseId,
				definitionId: processDefinitions.id,
				definitionSlug: processDefinitions.slug,
				namespace: namespaces.path,
				versionId: definitionVersions.id,
				version: definitionVersions.version,
				latestVersion: latest.version,
				body: definitionVersions.body,
				binding: caseAttachments.binding,
				label: caseAttachments.label,
				startedBy: caseAttachments.startedById,
				createdAt: caseAttachments.createdAt,
				completedAt: caseAttachments.completedAt
			})
			.from(caseAttachments)
			.innerJoin(definitionVersions, eq(definitionVersions.id, caseAttachments.definitionVersionId))
			.innerJoin(processDefinitions, eq(processDefinitions.id, definitionVersions.definitionId))
			.innerJoin(namespaces, eq(namespaces.id, processDefinitions.namespaceId))
			.leftJoin(latest, eq(latest.definitionId, processDefinitions.id))
			.where(inArray(caseAttachments.caseId, ids))
			.orderBy(asc(caseAttachments.createdAt), asc(caseAttachments.id)),
		db
			.select({
				id: caseEvents.id,
				seq: caseEvents.seq,
				caseId: caseEvents.caseId,
				attachmentId: caseEvents.attachmentId,
				item: caseEvents.item,
				type: caseEvents.type,
				by: caseEvents.actorId,
				onBehalfOf: caseEvents.onBehalfOfId,
				data: caseEvents.data,
				at: caseEvents.at
			})
			.from(caseEvents)
			.where(inArray(caseEvents.caseId, ids))
			.orderBy(asc(caseEvents.seq)),
		db
			.select({
				caseId: caseFacts.caseId,
				fact: caseFacts.fact,
				value: caseFacts.value,
				eventId: caseFacts.eventId
			})
			.from(caseFacts)
			.innerJoin(caseEvents, eq(caseEvents.id, caseFacts.eventId))
			.where(inArray(caseFacts.caseId, ids))
			.orderBy(asc(caseEvents.seq)),
		db
			.select({
				id: caseFiles.id,
				caseId: caseFiles.caseId,
				fact: caseFiles.fact,
				evidence: caseFiles.evidence,
				name: caseFiles.name,
				contentType: caseFiles.contentType,
				size: caseFiles.size,
				storageKey: caseFiles.storageKey,
				eventId: caseFiles.eventId
			})
			.from(caseFiles)
			.innerJoin(caseEvents, eq(caseEvents.id, caseFiles.eventId))
			.where(inArray(caseFiles.caseId, ids))
			.orderBy(asc(caseEvents.seq))
	]);

	const eventsById = new Map(eventRows.map((e) => [e.id, e]));
	const toEvent = (e: (typeof eventRows)[number]): EventRecord => ({
		seq: e.seq,
		type: e.type,
		by: e.by,
		data: (e.data ?? {}) as Record<string, unknown>,
		at: e.at,
		...(e.attachmentId ? { attachmentId: e.attachmentId } : {}),
		...(e.item ? { item: e.item } : {}),
		...(e.onBehalfOf ? { onBehalfOf: e.onBehalfOf } : {})
	});
	const provenance = (eventId: string) => {
		const e = eventsById.get(eventId)!;
		return {
			at: e.at,
			by: e.by,
			...(e.onBehalfOf ? { onBehalfOf: e.onBehalfOf } : {}),
			...(e.attachmentId ? { attachmentId: e.attachmentId } : {}),
			...(e.item ? { item: e.item } : {})
		};
	};

	const holders = await roleHolders(db, caseRows);
	const shared = new Map<string, Map<string, SharedLookups>>();
	for (const accountId of new Set(caseRows.map((c) => c.accountId))) {
		const ids = new Set(caseRows.filter((c) => c.accountId === accountId).map((c) => c.id));
		const paths = attachmentRows.filter((a) => ids.has(a.caseId)).map((a) => a.namespace);
		shared.set(accountId, await sharedLookupsAlong(db, accountId, paths));
	}
	const people = new Set<string>();
	const loaded = new Map<string, LoadedCase>();
	for (const c of caseRows) {
		const history = factRows
			.filter((f) => f.caseId === c.id)
			.map((f): FactRecord => ({ fact: f.fact, value: f.value, ...provenance(f.eventId) }));
		const facts = new Map(history.map((f) => [f.fact, f]));
		const values = Object.fromEntries([...facts].map(([id, f]) => [id, f.value]));
		const events = eventRows.filter((e) => e.caseId === c.id).map(toEvent);
		const attachments = attachmentRows
			.filter((a) => a.caseId === c.id)
			.map((a): LoadedAttachment => {
				const document = a.body as DefinitionDocument;
				const process = runnableProcess(document);
				const own = events.filter(
					(e) => e.attachmentId === a.id && e.item !== undefined && ITEM_EVENT_TYPES.has(e.type)
				);
				const itemEvents = own.map((e): ItemEvent => ({
					type: e.type as ItemEvent['type'],
					item: e.item!,
					by: e.by,
					at: e.at.toISOString(),
					data: e.data as ItemEvent['data'] & object
				}));
				const state = evaluateProcess(
					process,
					values,
					foldProgress(process, itemEvents),
					now,
					timeZone
				);
				const conversation = foldConversation(
					events
						.filter((e) => e.attachmentId === a.id && e.item !== undefined)
						.map((e) => ({
							seq: e.seq,
							type: e.type,
							item: e.item!,
							by: e.by,
							at: e.at.toISOString(),
							data: e.data
						}))
				);
				const roles = new Map<string, string[]>();
				for (const role of process.roles.keys()) {
					roles.set(role, holders.of(c, role));
				}
				return {
					id: a.id,
					caseId: a.caseId,
					definitionId: a.definitionId,
					definitionSlug: a.definitionSlug,
					namespace: a.namespace,
					versionId: a.versionId,
					version: a.version,
					latestVersion: a.latestVersion ?? a.version,
					binding: a.binding,
					createdAt: a.createdAt,
					document,
					process,
					shared: shared.get(c.accountId)?.get(a.namespace) ?? new Map(),
					state,
					holders: roles,
					events: own,
					conversation,
					...(a.label ? { label: a.label } : {}),
					...(a.startedBy ? { startedBy: a.startedBy } : {}),
					...(a.completedAt ? { completedAt: a.completedAt } : {})
				};
			});
		const files = fileRows
			.filter((f) => f.caseId === c.id)
			.map((f): FileRecord => ({
				id: f.id,
				name: f.name,
				contentType: f.contentType,
				size: f.size,
				storageKey: f.storageKey,
				...(f.fact ? { fact: f.fact } : {}),
				...(f.evidence ? { evidence: f.evidence } : {}),
				...provenance(f.eventId)
			}));
		for (const e of events) {
			people.add(e.by);
			if (e.onBehalfOf) people.add(e.onBehalfOf);
		}
		for (const a of attachments) {
			for (const hs of a.holders.values()) hs.forEach((h) => people.add(h));
			for (const q of a.conversation.questions) if (q.to) people.add(q.to);
		}
		for (const f of history) for (const v of principalValues(f, attachments)) people.add(v);
		if (c.openedBy) people.add(c.openedBy);
		loaded.set(c.id, {
			id: c.id,
			title: c.title,
			namespaceId: c.namespaceId,
			namespace: c.namespace,
			accountId: c.accountId,
			accountSlug: c.accountSlug,
			accountName: c.accountName,
			createdAt: c.createdAt,
			facts,
			history,
			files,
			attachments,
			events,
			...(c.subject ? { subject: c.subject } : {}),
			...(c.openedBy ? { openedBy: c.openedBy } : {})
		});
	}

	return {
		cases: caseIds.flatMap((id) => loaded.get(id) ?? []),
		people: await peopleById(db, [...people])
	};
}

/** Principal ids recorded as the value of a fact whose type looks principals up. */
function principalValues(record: FactRecord, attachments: LoadedAttachment[]): string[] {
	const fact = attachments.map((a) => a.process.facts.get(record.fact)).find(Boolean);
	if (fact?.core.schema['x-lookup']?.kind !== 'principal') return [];
	const values = Array.isArray(record.value) ? record.value : [record.value];
	return values.filter((v): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v));
}

/** Names and kinds of principals, by id. */
export async function peopleById(db: Queryable, ids: string[]): Promise<Map<string, Person>> {
	if (ids.length === 0) return new Map();
	const rows = await db
		.select({ id: principals.id, name: principals.displayName, kind: principals.kind })
		.from(principals)
		.where(inArray(principals.id, ids));
	return new Map(rows.map((r) => [r.id, r]));
}

/**
 * Who holds process roles on the cases: bindings on each case, then standing bindings along its
 * namespace lineage (ADR 0008). A group binding counts for each of its members, including the
 * members of nested groups. Holders are listed once each, case bindings first.
 */
async function roleHolders(
	db: Queryable,
	caseRows: { id: string; namespace: string; accountId: string }[]
) {
	const accountIds = [...new Set(caseRows.map((c) => c.accountId))];
	const paths = [...new Set(caseRows.flatMap((c) => namespacePathPrefixes(c.namespace)))];
	const lineage = await db
		.select({ id: namespaces.id, path: namespaces.path, accountId: namespaces.accountId })
		.from(namespaces)
		.where(and(inArray(namespaces.accountId, accountIds), inArray(namespaces.path, paths)));
	const bindings = await db
		.select({
			principalId: roleBindings.principalId,
			kind: principals.kind,
			role: roleBindings.role,
			namespaceId: roleBindings.namespaceId,
			caseId: roleBindings.caseId,
			createdAt: roleBindings.createdAt
		})
		.from(roleBindings)
		.innerJoin(principals, eq(principals.id, roleBindings.principalId))
		.where(
			and(
				sql`${roleBindings.role} NOT IN ${BUILT_IN_ROLES}`,
				sql`(${inArray(
					roleBindings.caseId,
					caseRows.map((c) => c.id)
				)} OR (${isNull(roleBindings.caseId)} AND ${inArray(
					roleBindings.namespaceId,
					lineage.length ? lineage.map((n) => n.id) : ['00000000-0000-0000-0000-000000000000']
				)}))`
			)
		)
		.orderBy(asc(roleBindings.createdAt));

	const groups = [...new Set(bindings.filter((b) => b.kind === 'group').map((b) => b.principalId))];
	const members = await groupMembersOf(db, groups);
	const expand = (id: string, kind: PrincipalKind) => (kind === 'group' ? members(id) : [id]);
	return {
		of(c: { id: string; namespace: string; accountId: string }, role: string): string[] {
			const prefixes = new Set(namespacePathPrefixes(c.namespace));
			const along = new Set(
				lineage.filter((n) => n.accountId === c.accountId && prefixes.has(n.path)).map((n) => n.id)
			);
			const onCase = bindings.filter((b) => b.caseId === c.id && b.role === role);
			const standing = bindings.filter(
				(b) =>
					b.caseId === null && b.role === role && b.namespaceId !== null && along.has(b.namespaceId)
			);
			return [...new Set([...onCase, ...standing].flatMap((b) => expand(b.principalId, b.kind)))];
		}
	};
}

/**
 * The roles, of those given, that nobody holds as a standing role on the definition's namespace or
 * an ancestor. A case of it waits on nobody in such a role unless its starter names someone.
 */
export async function rolesWithoutHolders(
	db: Queryable,
	definitionId: string,
	roles: string[]
): Promise<string[]> {
	const [definition] = await db
		.select({ namespace: namespaces.path, accountId: namespaces.accountId })
		.from(processDefinitions)
		.innerJoin(namespaces, eq(namespaces.id, processDefinitions.namespaceId))
		.where(eq(processDefinitions.id, definitionId));
	if (!definition || roles.length === 0) return [];
	// No case yet, so only standing bindings count.
	const none = { id: '00000000-0000-0000-0000-000000000000', ...definition };
	const holders = await roleHolders(db, [none]);
	return roles.filter((role) => holders.of(none, role).length === 0);
}

/** Resolves groups to the users and agents in them, through nested groups. */
async function groupMembersOf(db: Queryable, groups: string[]) {
	const rows = groups.length
		? await db.execute<{ group_id: string; member_id: string; kind: PrincipalKind }>(sql`
			WITH RECURSIVE tree(root, member) AS (
				SELECT gm.group_id, gm.member_id FROM ${groupMembers} gm WHERE gm.group_id IN ${groups}
				UNION
				SELECT t.root, gm.member_id FROM ${groupMembers} gm JOIN tree t ON gm.group_id = t.member
			)
			SELECT t.root AS group_id, t.member AS member_id, p.kind
			FROM tree t JOIN ${principals} p ON p.id = t.member`)
		: [];
	return (group: string) =>
		[...rows].filter((r) => r.group_id === group && r.kind !== 'group').map((r) => r.member_id);
}
