import { clone, deepFreeze } from './json.js';
import type { PublishedVersion } from './publish.js';
import type { Revision } from './revisions.js';

/**
 * Persistence for draft revisions and published versions, keyed by an opaque definition id.
 * `@casebook/store` is to implement this over its `draft_revisions` and `definition_versions`
 * tables; `InMemoryRevisionStore` is for tests. Both lists only grow, and numbering has no gaps,
 * which is how concurrent edits are detected.
 */
export interface RevisionStore {
	/** The draft's revisions, oldest first. */
	revisions(definitionId: string): Promise<Revision[]>;
	/** The newest revision, if the draft has any. */
	head(definitionId: string): Promise<Revision | undefined>;
	/** Adds a revision. Throws `NumberingConflictError` unless it is numbered one after the head. */
	appendRevision(definitionId: string, revision: Revision): Promise<void>;
	/** The published versions, oldest first. */
	versions(definitionId: string): Promise<PublishedVersion[]>;
	/** The newest published version, if any. */
	latestVersion(definitionId: string): Promise<PublishedVersion | undefined>;
	/** Adds a version. Throws `NumberingConflictError` unless it is numbered one after the latest. */
	appendVersion(definitionId: string, version: PublishedVersion): Promise<void>;
}

/** Another writer got there first: the number being written is not the next one. */
export class NumberingConflictError extends Error {
	constructor(
		readonly definitionId: string,
		readonly kind: 'revision' | 'version',
		readonly expected: number,
		readonly actual: number
	) {
		super(`${definitionId}: expected ${kind} ${expected} next, but got ${kind} ${actual}`);
		this.name = 'NumberingConflictError';
	}
}

/** Keeps revisions and versions in memory. Stored values are frozen copies. */
export class InMemoryRevisionStore implements RevisionStore {
	readonly #revisions = new Map<string, Revision[]>();
	readonly #versions = new Map<string, PublishedVersion[]>();

	async revisions(definitionId: string): Promise<Revision[]> {
		return [...(this.#revisions.get(definitionId) ?? [])];
	}

	async head(definitionId: string): Promise<Revision | undefined> {
		return this.#revisions.get(definitionId)?.at(-1);
	}

	async appendRevision(definitionId: string, revision: Revision): Promise<void> {
		append(this.#revisions, definitionId, 'revision', revision.number, revision);
	}

	async versions(definitionId: string): Promise<PublishedVersion[]> {
		return [...(this.#versions.get(definitionId) ?? [])];
	}

	async latestVersion(definitionId: string): Promise<PublishedVersion | undefined> {
		return this.#versions.get(definitionId)?.at(-1);
	}

	async appendVersion(definitionId: string, version: PublishedVersion): Promise<void> {
		append(this.#versions, definitionId, 'version', version.version, version);
	}
}

function append<T>(
	lists: Map<string, T[]>,
	definitionId: string,
	kind: 'revision' | 'version',
	number: number,
	value: T
): void {
	const list = lists.get(definitionId) ?? [];
	if (number !== list.length + 1) {
		throw new NumberingConflictError(definitionId, kind, list.length + 1, number);
	}
	lists.set(definitionId, [...list, deepFreeze(clone(value))]);
}
