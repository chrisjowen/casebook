/** The app's one Postgres client, created on first use from DATABASE_URL. */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDb, type Db } from '@casebook/store';

let db: Db | undefined;

export function getDb(): Db {
	if (db) return db;
	let url = process.env.DATABASE_URL;
	if (!url) {
		// Like the store package: fall back to the repository root .env in development.
		const rootEnv = fileURLToPath(new URL('../../../../../.env', import.meta.url));
		if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
		url = process.env.DATABASE_URL;
	}
	if (!url) {
		throw new Error('DATABASE_URL is not set; copy .env.example to .env at the repository root.');
	}
	db = createDb(url);
	return db;
}
