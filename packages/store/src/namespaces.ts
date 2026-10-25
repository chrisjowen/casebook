import { desc, inArray, sql } from 'drizzle-orm';
import type { Db } from './client.js';
import { namespaces } from './schema.js';

export type Namespace = typeof namespaces.$inferSelect;

/** Every prefix of a namespace path, nearest first: `a/b/c` gives `a/b/c`, `a/b`, `a`. */
export function namespacePathPrefixes(path: string): string[] {
	const segments = path.split('/');
	return segments.map((_, i) => segments.slice(0, segments.length - i).join('/'));
}

/**
 * The namespace at `path` and its existing ancestors, nearest first. This is the order role
 * bindings and other inherited lookups resolve in (ADR 0007, ADR 0008).
 */
export async function findNamespaceLineage(db: Db, path: string): Promise<Namespace[]> {
	return db
		.select()
		.from(namespaces)
		.where(inArray(namespaces.path, namespacePathPrefixes(path)))
		.orderBy(desc(sql`length(${namespaces.path})`));
}
