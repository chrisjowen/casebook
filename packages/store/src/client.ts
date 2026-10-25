import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

/** Creates a Drizzle client for the given Postgres connection string. */
export function createDb(url: string) {
	return drizzle(postgres(url), { schema });
}

export type Db = ReturnType<typeof createDb>;
