import type { PgDatabase } from 'drizzle-orm/pg-core';
import { drizzle, type PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

/** Creates a Drizzle client for the given Postgres connection string. */
export function createDb(url: string) {
	return drizzle(postgres(url), { schema });
}

export type Db = ReturnType<typeof createDb>;

/** A transaction opened with `db.transaction`. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Anything that runs queries: a client or a transaction. */
export type Queryable = PgDatabase<PostgresJsQueryResultHKT, typeof schema>;
