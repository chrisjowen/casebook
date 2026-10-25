// Spreadsheet imports in progress (ADR 0011). A session holds the workbook as read and the wizard's
// own state, which `@casebook/wizard-agent` defines; the store keeps both as opaque JSON. Starting
// one needs `definition.create` in its namespace, since accepting its split creates definitions
// there, and only the principal who started it can read or save it. Every definition edit the
// wizard makes still goes through the definition service with the actor's own permissions.
import { and, desc, eq } from 'drizzle-orm';
import { can, type Actor } from './authz.js';
import type { Db } from './client.js';
import type { Refusal } from './definitions.js';
import { wizardSessions } from './schema.js';

export interface WizardSessionRecord<State = unknown, Book = unknown> {
	id: string;
	namespaceId: string;
	fileName: string;
	workbook: Book;
	state: State;
	/** Increases with every save; a save names the version it was based on. */
	version: number;
	createdAt: Date;
	updatedAt: Date;
}

export interface NewWizardSession<State, Book> {
	namespaceId: string;
	fileName: string;
	workbook: Book;
	state: State;
}

/** Starts a wizard session in a namespace for the actor, who needs `definition.create` there. */
export async function createWizardSession<State, Book>(
	db: Db,
	actor: Actor,
	input: NewWizardSession<State, Book>
): Promise<{ ok: true; session: WizardSessionRecord<State, Book> } | Refusal> {
	const decision = await can(db, actor, 'definition.create', {
		type: 'namespace',
		namespaceId: input.namespaceId
	});
	if (!decision.allowed) return refuse('access-denied', decision.reason);
	const [row] = await db
		.insert(wizardSessions)
		.values({
			namespaceId: input.namespaceId,
			ownerId: ownerOf(actor),
			fileName: input.fileName,
			workbook: input.workbook,
			state: input.state
		})
		.returning();
	return { ok: true, session: toRecord<State, Book>(row!) };
}

/** A session the actor started, or a refusal when it does not exist or is someone else's. */
export async function loadWizardSession<State, Book>(
	db: Db,
	actor: Actor,
	id: string
): Promise<{ ok: true; session: WizardSessionRecord<State, Book> } | Refusal> {
	if (!UUID.test(id)) return missing(id);
	const [row] = await db
		.select()
		.from(wizardSessions)
		.where(and(eq(wizardSessions.id, id), eq(wizardSessions.ownerId, ownerOf(actor))));
	return row ? { ok: true, session: toRecord<State, Book>(row) } : missing(id);
}

/** The sessions the actor started in a namespace, newest first, without their workbooks. */
export async function listWizardSessions<State>(
	db: Db,
	actor: Actor,
	namespaceId: string
): Promise<Omit<WizardSessionRecord<State, never>, 'workbook'>[]> {
	if (!UUID.test(namespaceId)) return [];
	const rows = await db
		.select({
			id: wizardSessions.id,
			namespaceId: wizardSessions.namespaceId,
			fileName: wizardSessions.fileName,
			state: wizardSessions.state,
			version: wizardSessions.version,
			createdAt: wizardSessions.createdAt,
			updatedAt: wizardSessions.updatedAt
		})
		.from(wizardSessions)
		.where(
			and(eq(wizardSessions.namespaceId, namespaceId), eq(wizardSessions.ownerId, ownerOf(actor)))
		)
		.orderBy(desc(wizardSessions.updatedAt));
	return rows.map((r) => ({ ...r, state: r.state as State }));
}

/**
 * Saves a session's state over `baseVersion`. A newer saved version refuses it as stale, so two
 * requests working on the same session cannot silently overwrite each other.
 */
export async function saveWizardSession<State>(
	db: Db,
	actor: Actor,
	input: { id: string; baseVersion: number; state: State }
): Promise<{ ok: true; version: number } | Refusal> {
	if (!UUID.test(input.id)) return missing(input.id);
	const [row] = await db
		.update(wizardSessions)
		.set({ state: input.state, version: input.baseVersion + 1 })
		.where(
			and(
				eq(wizardSessions.id, input.id),
				eq(wizardSessions.ownerId, ownerOf(actor)),
				eq(wizardSessions.version, input.baseVersion)
			)
		)
		.returning({ version: wizardSessions.version });
	if (row) return { ok: true, version: row.version };
	const current = await loadWizardSession(db, actor, input.id);
	if (!current.ok) return current;
	return refuse(
		'stale-draft',
		'The import changed while you were working on it; reload to see the latest'
	);
}

/** The principal a session belongs to: the one the actor acts for, or the actor. */
const ownerOf = (actor: Actor) => actor.onBehalfOfId ?? actor.id;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toRecord<State, Book>(
	row: typeof wizardSessions.$inferSelect
): WizardSessionRecord<State, Book> {
	return {
		id: row.id,
		namespaceId: row.namespaceId,
		fileName: row.fileName,
		workbook: row.workbook as Book,
		state: row.state as State,
		version: row.version,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt
	};
}

function refuse(code: Refusal['code'], reason: string): Refusal {
	return { ok: false, code, reason, errors: [], issues: [] };
}

const missing = (id: string) => refuse('not-found', `import ${id} does not exist`);
