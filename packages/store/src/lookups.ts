// Shared lookups (ADR 0025): named lists of values a namespace offers the choice facts of its
// processes and of its descendants' processes, such as countries or insurers. Each saved change
// is a new version, so processes always choose from the latest. `@casebook/model` decides what a
// valid list is and describes changes; this file stores them and checks the actor with `can`.
import { and, asc, desc, eq, inArray, max } from 'drizzle-orm';
import {
	describeValueChanges,
	factsUsingShared,
	lookupListProblem,
	type DefinitionDocument,
	type FactNode,
	type LookupList,
	type SharedLookups
} from '@casebook/model';
import { can, namespacePathPrefixes, type Actor, type Decision } from './authz.js';
import type { Db, Queryable } from './client.js';
import type { NamespaceRef, Refusal } from './definitions.js';
import {
	accounts,
	definitionVersions,
	draftRevisions,
	namespaces,
	principals,
	processDefinitions,
	sharedLookups,
	sharedLookupVersions
} from './schema.js';

/** A shared lookup as people see it: its latest version, and who saved it. */
export interface SharedLookup extends LookupList {
	id: string;
	/** What facts call it, unique in its namespace. */
	name: string;
	namespace: NamespaceRef;
	version: number;
	updatedAt: Date;
	updatedByName: string;
}

/** A namespace the actor can read, its shared lookups, and whether they may change them. */
export interface NamespaceLookups {
	namespace: NamespaceRef;
	can: { edit: Decision };
	lookups: SharedLookup[];
}

/** A process that chooses from a shared lookup, and the facts that do. */
export interface LookupUse {
	definitionId: string;
	slug: string;
	title: string;
	namespace: string;
	facts: { id: string; title: string }[];
	/** True when only its draft uses the lookup so far, not its latest published version. */
	draftOnly: boolean;
}

/** One saved version of a shared lookup, with what it changed. */
export interface LookupVersion {
	version: number;
	at: Date;
	byName: string;
	/** What changed from the version before, in plain words; the first says it was made. */
	summary: string[];
}

export interface LookupSaved {
	ok: true;
	id: string;
	name: string;
	version: number;
}

/**
 * Every namespace `actor` may read in the instance (account) `accountSlug`, ordered by path, with
 * its shared lookups by title and whether the actor may change them.
 */
export async function listSharedLookups(
	db: Db,
	actor: Actor,
	accountSlug: string
): Promise<NamespaceLookups[]> {
	const rows = await db
		.select({
			id: namespaces.id,
			accountId: namespaces.accountId,
			accountSlug: accounts.slug,
			path: namespaces.path
		})
		.from(namespaces)
		.innerJoin(accounts, eq(accounts.id, namespaces.accountId))
		.where(eq(accounts.slug, accountSlug))
		.orderBy(asc(namespaces.path));
	const result: NamespaceLookups[] = [];
	for (const namespace of rows) {
		const resource = { type: 'namespace', namespaceId: namespace.id } as const;
		if (!(await can(db, actor, 'definition.read', resource)).allowed) continue;
		result.push({
			namespace,
			can: { edit: await can(db, actor, 'lookup.edit', resource) },
			lookups: await latestIn(db, [namespace])
		});
	}
	return result;
}

/**
 * The shared lookups a process in `namespacePath` of the account can choose from, by name: those
 * of its namespace and every ancestor, the nearest winning when two share a name.
 */
export async function sharedLookupsFor(
	db: Queryable,
	accountId: string,
	namespacePath: string
): Promise<SharedLookups> {
	return (await sharedLookupsAlong(db, accountId, [namespacePath])).get(namespacePath)!;
}

/** `sharedLookupsFor` for several namespaces of one account at once, by path. */
export async function sharedLookupsAlong(
	db: Queryable,
	accountId: string,
	namespacePaths: readonly string[]
): Promise<Map<string, SharedLookups>> {
	const paths = [...new Set(namespacePaths.flatMap(namespacePathPrefixes))];
	const lineage = paths.length
		? await db
				.select({
					id: namespaces.id,
					accountId: namespaces.accountId,
					accountSlug: accounts.slug,
					path: namespaces.path
				})
				.from(namespaces)
				.innerJoin(accounts, eq(accounts.id, namespaces.accountId))
				.where(and(eq(namespaces.accountId, accountId), inArray(namespaces.path, paths)))
		: [];
	const lists = await latestIn(db, lineage);
	const result = new Map<string, SharedLookups>();
	for (const path of namespacePaths) {
		const visible = new Map<string, LookupList>();
		// farthest first, so a nearer namespace's list of the same name replaces it
		for (const prefix of namespacePathPrefixes(path).reverse()) {
			for (const l of lists.filter((x) => x.namespace.path === prefix)) {
				visible.set(l.name, bodyOf(l));
			}
		}
		result.set(path, visible);
	}
	return result;
}

/** A shared lookup by id, if it exists and `actor` may read its namespace. */
export async function readSharedLookup(
	db: Db,
	actor: Actor,
	lookupId: string
): Promise<{ ok: true; lookup: SharedLookup; can: { edit: Decision } } | Refusal> {
	const found = await findLookup(db, lookupId);
	if (!found) return refuse('not-found', `shared lookup ${lookupId} does not exist`);
	const resource = { type: 'namespace', namespaceId: found.namespace.id } as const;
	const read = await can(db, actor, 'definition.read', resource);
	if (!read.allowed) return refuse('access-denied', read.reason);
	const [latest] = await latestIn(db, [found.namespace], lookupId);
	return {
		ok: true,
		lookup: latest!,
		can: { edit: await can(db, actor, 'lookup.edit', resource) }
	};
}

/**
 * The processes that choose from a shared lookup: those in its namespace or below whose draft or
 * latest published version names it, and do not see a nearer list of the same name.
 */
export async function sharedLookupUses(db: Db, lookup: SharedLookup): Promise<LookupUse[]> {
	const inside = (
		await db
			.select({ id: namespaces.id, path: namespaces.path })
			.from(namespaces)
			.where(eq(namespaces.accountId, lookup.namespace.accountId))
	).filter(
		(n) => n.path === lookup.namespace.path || n.path.startsWith(`${lookup.namespace.path}/`)
	);
	if (inside.length === 0) return [];
	const definitions = await db
		.select({
			id: processDefinitions.id,
			slug: processDefinitions.slug,
			namespaceId: processDefinitions.namespaceId
		})
		.from(processDefinitions)
		.where(
			inArray(
				processDefinitions.namespaceId,
				inside.map((n) => n.id)
			)
		)
		.orderBy(asc(processDefinitions.slug));
	const uses: LookupUse[] = [];
	for (const d of definitions) {
		const path = inside.find((n) => n.id === d.namespaceId)!.path;
		// a nearer namespace's list of the same name hides this one there
		const seen = await nearestOwner(db, lookup.namespace.accountId, path, lookup.name);
		if (seen !== lookup.id) continue;
		const [draft] = await db
			.select({ body: draftRevisions.body })
			.from(draftRevisions)
			.where(eq(draftRevisions.definitionId, d.id))
			.orderBy(desc(draftRevisions.revision))
			.limit(1);
		const [published] = await db
			.select({ body: definitionVersions.body })
			.from(definitionVersions)
			.where(
				and(eq(definitionVersions.definitionId, d.id), eq(definitionVersions.status, 'published'))
			)
			.orderBy(desc(definitionVersions.version))
			.limit(1);
		const document = (draft?.body ?? published?.body) as DefinitionDocument | undefined;
		if (!document) continue;
		const facts = factsUsingShared(document, lookup.name);
		const live = published
			? factsUsingShared(published.body as DefinitionDocument, lookup.name)
			: [];
		if (facts.length === 0 && live.length === 0) continue;
		const titled = (ids: string[]) =>
			ids.map((id) => {
				const node = document.nodes.find((n) => n.core.id === id) as FactNode | undefined;
				return { id, title: node?.core.title ?? id };
			});
		const process = document.nodes.find((n) => n.core.kind === 'process');
		uses.push({
			definitionId: d.id,
			slug: d.slug,
			title: process?.core.title ?? d.slug,
			namespace: path,
			facts: titled(facts.length ? facts : live),
			draftOnly: live.length === 0
		});
	}
	return uses;
}

/** A shared lookup's versions, newest first, each with what it changed. */
export async function sharedLookupHistory(db: Db, lookupId: string): Promise<LookupVersion[]> {
	const rows = await db
		.select({
			version: sharedLookupVersions.version,
			body: sharedLookupVersions.body,
			revertedTo: sharedLookupVersions.revertedTo,
			at: sharedLookupVersions.createdAt,
			byName: principals.displayName
		})
		.from(sharedLookupVersions)
		.innerJoin(principals, eq(principals.id, sharedLookupVersions.authorId))
		.where(eq(sharedLookupVersions.lookupId, lookupId))
		.orderBy(asc(sharedLookupVersions.version));
	return rows
		.map((r, i) => {
			const body = r.body as LookupList;
			const before = rows[i - 1]?.body as LookupList | undefined;
			return {
				version: r.version,
				at: r.at,
				byName: r.byName,
				summary: before
					? r.revertedTo !== null
						? [`Undid changes, back to version ${r.revertedTo}`]
						: describeListChanges(before, body)
					: [`Made with ${body.values.length} ${body.values.length === 1 ? 'value' : 'values'}`]
			};
		})
		.reverse();
}

export interface NewSharedLookup {
	namespaceId: string;
	title: string;
	values?: LookupList['values'];
}

/**
 * Makes a shared lookup in a namespace, named from its title and numbered when the name is taken.
 * The actor needs `lookup.edit` on the namespace.
 */
export async function createSharedLookup(
	db: Db,
	actor: Actor,
	input: NewSharedLookup
): Promise<LookupSaved | Refusal> {
	const denied = await permission(db, actor, input.namespaceId);
	if (denied) return denied;
	const body: LookupList = { title: input.title.trim(), values: input.values ?? [] };
	const problem = lookupListProblem(body);
	if (problem) return refuse('invalid-operation', problem);
	const taken = new Set(
		(
			await db
				.select({ name: sharedLookups.name })
				.from(sharedLookups)
				.where(eq(sharedLookups.namespaceId, input.namespaceId))
		).map((r) => r.name)
	);
	const base = nameOf(body.title);
	let name = base;
	for (let n = 2; taken.has(name); n++) name = `${base}-${n}`;
	return db.transaction(async (tx) => {
		const [row] = await tx
			.insert(sharedLookups)
			.values({ namespaceId: input.namespaceId, name, createdById: actor.id })
			.returning({ id: sharedLookups.id });
		await tx.insert(sharedLookupVersions).values({
			lookupId: row!.id,
			version: 1,
			body,
			authorId: actor.id,
			...(actor.onBehalfOfId === undefined ? {} : { onBehalfOfId: actor.onBehalfOfId })
		});
		return { ok: true as const, id: row!.id, name, version: 1 };
	});
}

export interface SharedLookupEdit {
	lookupId: string;
	/** New title, values or guidance; what is left out stays. `content: null` removes the guidance. */
	changes: { title?: string; values?: LookupList['values']; content?: string | null };
	/** The version the change was made against; a newer one refuses it as stale. */
	baseVersion: number;
}

/**
 * Saves a change to a shared lookup as its next version, which every process that chooses from
 * it sees straight away. The actor needs `lookup.edit` on its namespace.
 */
export async function editSharedLookup(
	db: Db,
	actor: Actor,
	input: SharedLookupEdit
): Promise<LookupSaved | Refusal> {
	const found = await findLookup(db, input.lookupId);
	if (!found) return refuse('not-found', `shared lookup ${input.lookupId} does not exist`);
	const denied = await permission(db, actor, found.namespace.id);
	if (denied) return denied;
	const head = await headOf(db, input.lookupId);
	if (head.version !== input.baseVersion) return stale(head.version, input.baseVersion);
	const { content, ...rest } = input.changes;
	const next: LookupList = { ...head.body, ...rest };
	if (content === null) delete next.content;
	else if (content !== undefined) next.content = content;
	if (typeof next.title === 'string') next.title = next.title.trim();
	const problem = lookupListProblem(next);
	if (problem) return refuse('invalid-operation', problem);
	if (JSON.stringify(next) === JSON.stringify(head.body)) {
		return refuse('no-change', 'Nothing changed');
	}
	return save(db, actor, found, head.version + 1, next);
}

/** Undoes the latest change to a shared lookup, as a new version restoring the one before it. */
export async function undoSharedLookupEdit(
	db: Db,
	actor: Actor,
	input: Omit<SharedLookupEdit, 'changes'>
): Promise<LookupSaved | Refusal> {
	const found = await findLookup(db, input.lookupId);
	if (!found) return refuse('not-found', `shared lookup ${input.lookupId} does not exist`);
	const denied = await permission(db, actor, found.namespace.id);
	if (denied) return denied;
	const head = await headOf(db, input.lookupId);
	if (head.version !== input.baseVersion) return stale(head.version, input.baseVersion);
	// an undo of an undo goes back past the version it restored
	const target = (head.revertedTo ?? head.version) - 1;
	if (target < 1) return refuse('nothing-to-undo', 'There is nothing to undo');
	const [earlier] = await db
		.select({ body: sharedLookupVersions.body })
		.from(sharedLookupVersions)
		.where(
			and(
				eq(sharedLookupVersions.lookupId, input.lookupId),
				eq(sharedLookupVersions.version, target)
			)
		);
	return save(db, actor, found, head.version + 1, earlier!.body as LookupList, target);
}

/** Deletes a shared lookup no process chooses from. */
export async function deleteSharedLookup(
	db: Db,
	actor: Actor,
	lookupId: string
): Promise<{ ok: true } | Refusal> {
	const read = await readSharedLookup(db, actor, lookupId);
	if (!read.ok) return read;
	if (!read.can.edit.allowed) return refuse('access-denied', read.can.edit.reason);
	const uses = await sharedLookupUses(db, read.lookup);
	if (uses.length) {
		return refuse(
			'referenced',
			`${read.lookup.title} is still used by ${uses.map((u) => u.title).join(', ')}; choose another list for those facts first`
		);
	}
	await db.delete(sharedLookups).where(eq(sharedLookups.id, lookupId));
	return { ok: true };
}

/** What changed between two versions of a shared lookup, in plain words. */
export function describeListChanges(before: LookupList, after: LookupList): string[] {
	const parts: string[] = [];
	if (before.title !== after.title) parts.push(`Renamed it to ${after.title}`);
	if ((before.content ?? '') !== (after.content ?? '')) parts.push('Changed its guidance');
	const values = describeValueChanges(before.values, after.values);
	if (values.length) parts.push(capitalise(values.join('; ')));
	return parts.length ? parts : ['No change'];
}

// Internals

interface FoundLookup {
	id: string;
	name: string;
	namespace: NamespaceRef;
}

async function findLookup(db: Queryable, lookupId: string): Promise<FoundLookup | undefined> {
	if (!/^[0-9a-f-]{36}$/i.test(lookupId)) return undefined;
	const [row] = await db
		.select({
			id: sharedLookups.id,
			name: sharedLookups.name,
			namespaceId: namespaces.id,
			accountId: namespaces.accountId,
			accountSlug: accounts.slug,
			path: namespaces.path
		})
		.from(sharedLookups)
		.innerJoin(namespaces, eq(namespaces.id, sharedLookups.namespaceId))
		.innerJoin(accounts, eq(accounts.id, namespaces.accountId))
		.where(eq(sharedLookups.id, lookupId));
	return (
		row && {
			id: row.id,
			name: row.name,
			namespace: {
				id: row.namespaceId,
				accountId: row.accountId,
				accountSlug: row.accountSlug,
				path: row.path
			}
		}
	);
}

/** The latest version of every shared lookup in these namespaces, or of just one. */
async function latestIn(
	db: Queryable,
	inNamespaces: readonly NamespaceRef[],
	onlyId?: string
): Promise<SharedLookup[]> {
	if (inNamespaces.length === 0) return [];
	const heads = db
		.select({
			lookupId: sharedLookupVersions.lookupId,
			version: max(sharedLookupVersions.version).as('head_version')
		})
		.from(sharedLookupVersions)
		.groupBy(sharedLookupVersions.lookupId)
		.as('heads');
	const rows = await db
		.select({
			id: sharedLookups.id,
			name: sharedLookups.name,
			namespaceId: sharedLookups.namespaceId,
			version: sharedLookupVersions.version,
			body: sharedLookupVersions.body,
			updatedAt: sharedLookupVersions.createdAt,
			updatedByName: principals.displayName
		})
		.from(sharedLookups)
		.innerJoin(heads, eq(heads.lookupId, sharedLookups.id))
		.innerJoin(
			sharedLookupVersions,
			and(
				eq(sharedLookupVersions.lookupId, sharedLookups.id),
				eq(sharedLookupVersions.version, heads.version)
			)
		)
		.innerJoin(principals, eq(principals.id, sharedLookupVersions.authorId))
		.where(
			and(
				inArray(
					sharedLookups.namespaceId,
					inNamespaces.map((n) => n.id)
				),
				onlyId === undefined ? undefined : eq(sharedLookups.id, onlyId)
			)
		);
	return rows
		.map((r) => {
			const body = r.body as LookupList;
			return {
				id: r.id,
				name: r.name,
				namespace: inNamespaces.find((n) => n.id === r.namespaceId)!,
				version: r.version,
				updatedAt: r.updatedAt,
				updatedByName: r.updatedByName,
				...body
			};
		})
		.sort((a, b) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }));
}

/** The id of the shared lookup called `name` that a process in `path` sees, if any. */
async function nearestOwner(
	db: Queryable,
	accountId: string,
	path: string,
	name: string
): Promise<string | undefined> {
	const rows = await db
		.select({ id: sharedLookups.id, path: namespaces.path })
		.from(sharedLookups)
		.innerJoin(namespaces, eq(namespaces.id, sharedLookups.namespaceId))
		.where(
			and(
				eq(namespaces.accountId, accountId),
				eq(sharedLookups.name, name),
				inArray(namespaces.path, namespacePathPrefixes(path))
			)
		);
	return rows.sort((a, b) => b.path.length - a.path.length)[0]?.id;
}

async function headOf(db: Queryable, lookupId: string) {
	const [row] = await db
		.select({
			version: sharedLookupVersions.version,
			body: sharedLookupVersions.body,
			revertedTo: sharedLookupVersions.revertedTo
		})
		.from(sharedLookupVersions)
		.where(eq(sharedLookupVersions.lookupId, lookupId))
		.orderBy(desc(sharedLookupVersions.version))
		.limit(1);
	return { version: row!.version, body: row!.body as LookupList, revertedTo: row!.revertedTo };
}

async function save(
	db: Db,
	actor: Actor,
	found: FoundLookup,
	version: number,
	body: LookupList,
	revertedTo?: number
): Promise<LookupSaved | Refusal> {
	try {
		await db.transaction(async (tx) => {
			await tx.insert(sharedLookupVersions).values({
				lookupId: found.id,
				version,
				body,
				authorId: actor.id,
				...(actor.onBehalfOfId === undefined ? {} : { onBehalfOfId: actor.onBehalfOfId }),
				...(revertedTo === undefined ? {} : { revertedTo })
			});
			await tx
				.update(sharedLookups)
				.set({ updatedAt: new Date() })
				.where(eq(sharedLookups.id, found.id));
		});
	} catch (error) {
		// two saves against the same version: the unique key refuses the second
		if (String((error as { cause?: { code?: string } }).cause?.code ?? '') === '23505') {
			return stale(version, version - 1);
		}
		throw error;
	}
	return { ok: true, id: found.id, name: found.name, version };
}

function bodyOf(l: SharedLookup): LookupList {
	return { title: l.title, values: l.values, ...(l.content ? { content: l.content } : {}) };
}

async function permission(db: Db, actor: Actor, namespaceId: string) {
	const decision = await can(db, actor, 'lookup.edit', { type: 'namespace', namespaceId });
	return decision.allowed ? undefined : refuse('access-denied', decision.reason);
}

/** "Insurers (EU)" is called "insurers-eu". */
function nameOf(title: string): string {
	return (
		title
			.normalize('NFKD')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '') || 'list'
	);
}

function refuse(code: Refusal['code'], reason: string): Refusal {
	return { ok: false, code, reason, errors: [], issues: [] };
}

const stale = (head: number, base: number) =>
	refuse(
		'stale-draft',
		`The list changed while you were editing (version ${head}, not ${base}); reload to see the latest`
	);

function capitalise(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}
