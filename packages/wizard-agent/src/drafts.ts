/**
 * How the wizard reaches process definitions: create, read, preview an edit and save it, always as
 * the signed-in person. `storeDrafts` is the real one, over `@casebook/store`'s definition service,
 * so the agent can do exactly what that person can and every write is a node-operation edit
 * checked by the same layer as the editor's (ADR 0011, ADR 0020). `memoryDrafts` keeps drafts in
 * memory with the same model checks, for tests.
 */
import {
	commit,
	diff,
	SCHEMA_VERSION,
	startHistory,
	type Change,
	type DefinitionDocument,
	type InvariantIssue,
	type Operation,
	type Revision,
	type SourceRef
} from '@casebook/model';
import {
	createDefinition,
	editDefinition,
	previewDefinitionEdit,
	readDraft,
	type Actor,
	type Db,
	type Refusal
} from '@casebook/store';

/** Why something was not done, in plain language. Nothing was written. */
export interface Refused {
	ok: false;
	reason: string;
	/** The schema errors and publish-blocking issues behind it, if any. */
	problems: string[];
}

export interface DraftHead {
	ok: true;
	revision: number;
	document: DefinitionDocument;
}

export interface Preview {
	ok: true;
	revision: number;
	document: DefinitionDocument;
	changes: Change[];
	warnings: InvariantIssue[];
}

export interface NewProcess {
	namespaceId: string;
	title: string;
	source: SourceRef;
}

export interface DraftAccess {
	/** Creates a governed process holding only its process node. */
	create(input: NewProcess): Promise<{ ok: true; definitionId: string; slug: string } | Refused>;
	head(definitionId: string): Promise<DraftHead | Refused>;
	/** Checks operations as one edit of the draft at `baseRevision`, without saving them. */
	preview(definitionId: string, baseRevision: number, ops: Operation[]): Promise<Preview | Refused>;
	/** Saves operations as one edit of the draft at `baseRevision`. */
	edit(
		definitionId: string,
		baseRevision: number,
		ops: Operation[]
	): Promise<{ ok: true; revision: number } | Refused>;
}

function refused(r: Refusal): Refused {
	return {
		ok: false,
		reason: r.reason,
		problems: [...r.errors, ...r.issues.filter((i) => i.severity === 'error')].map((p) => p.message)
	};
}

/** Drafts in Postgres, read and written as `actor` through the store's definition service. */
export function storeDrafts(db: Db, actor: Actor): DraftAccess {
	return {
		async create({ namespaceId, title, source }) {
			const r = await createDefinition(db, actor, { namespaceId, title, blank: true, source });
			return r.ok ? { ok: true, definitionId: r.definitionId, slug: r.slug } : refused(r);
		},
		async head(definitionId) {
			const r = await readDraft(db, actor, definitionId);
			return r.ok ? r : refused(r);
		},
		async preview(definitionId, baseRevision, ops) {
			const r = await previewDefinitionEdit(db, actor, { definitionId, baseRevision, ops });
			return r.ok ? r : refused(r);
		},
		async edit(definitionId, baseRevision, ops) {
			const r = await editDefinition(db, actor, { definitionId, baseRevision, ops });
			return r.ok ? { ok: true, revision: r.revision } : refused(r);
		}
	};
}

/**
 * Drafts kept in memory and checked by the model exactly as the store checks them, minus
 * permissions. For tests; `drafts` exposes each definition's revisions.
 */
export function memoryDrafts(namespace = 'acme/test'): DraftAccess & {
	drafts: Map<string, Revision[]>;
} {
	const drafts = new Map<string, Revision[]>();
	const author = { author: { id: 'user-1', kind: 'user' as const } };
	const head = (id: string) => drafts.get(id)?.at(-1);
	const missing = (id: string): Refused => ({
		ok: false,
		reason: `definition ${id} does not exist`,
		problems: []
	});
	const stale = (at: number, base: number): Refused => ({
		ok: false,
		reason: `The draft changed while you were editing (revision ${at}, not ${base}); reload to see the latest`,
		problems: []
	});
	const rejected = (r: {
		reason: string;
		errors: { message: string }[];
		issues: InvariantIssue[];
	}) => ({
		ok: false as const,
		reason: r.reason,
		problems: [...r.errors, ...r.issues.filter((i) => i.severity === 'error')].map((p) => p.message)
	});
	return {
		drafts,
		async create({ title, source }) {
			const base =
				title
					.toLowerCase()
					.replace(/[^a-z0-9]+/g, '-')
					.replace(/^-|-$/g, '') || 'process';
			let slug = base;
			for (let n = 2; drafts.has(slug); n++) slug = `${base}-${n}`;
			const document: DefinitionDocument = {
				schemaVersion: SCHEMA_VERSION,
				namespace,
				slug,
				version: 1,
				nodes: [{ core: { id: `process.${slug}`, kind: 'process', title, source } }]
			};
			const started = startHistory(document, author);
			if (!started.ok) return rejected(started);
			drafts.set(slug, [started.revision]);
			return { ok: true, definitionId: slug, slug };
		},
		async head(id) {
			const h = head(id);
			return h ? { ok: true, revision: h.number, document: h.document } : missing(id);
		},
		async preview(id, baseRevision, ops) {
			const h = head(id);
			if (!h) return missing(id);
			if (h.number !== baseRevision) return stale(h.number, baseRevision);
			const r = commit(h, ops, author);
			if (!r.ok) return rejected(r);
			return {
				ok: true,
				revision: h.number,
				document: r.revision.document,
				changes: diff(h.document, r.revision.document),
				warnings: r.warnings
			};
		},
		async edit(id, baseRevision, ops) {
			const h = head(id);
			if (!h) return missing(id);
			if (h.number !== baseRevision) return stale(h.number, baseRevision);
			const r = commit(h, ops, author);
			if (!r.ok) return rejected(r);
			drafts.get(id)!.push(r.revision);
			return { ok: true, revision: r.revision.number };
		}
	};
}
