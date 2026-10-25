import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import type { TestProject } from 'vitest/node';
import { runMigrations } from '../src/migrate.js';

declare module 'vitest' {
	export interface ProvidedContext {
		/** A freshly migrated throwaway database, or null when DATABASE_URL is unset. */
		testDatabaseUrl: string | null;
	}
}

// Matches drizzle.config.ts: use the repository root .env when present.
const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnv)) {
	process.loadEnvFile(rootEnv);
}

/**
 * Creates a throwaway database next to the one DATABASE_URL names, applies the committed
 * migrations to it, and drops it afterwards, so tests start empty and never touch dev data.
 */
export default async function setup(project: TestProject) {
	const url = process.env.DATABASE_URL;
	if (!url) {
		if (process.env.CI) {
			const message = 'DATABASE_URL must be set in CI; the store tests need Postgres.';
			// Also log it: vitest 5 can fail to print errors thrown from global setup.
			console.error(`\n@casebook/store: ${message}\n`);
			throw new Error(message);
		}
		console.warn(
			'\n@casebook/store: DATABASE_URL is not set, so the database tests are skipped.\n' +
				'Run `pnpm db:up` and copy .env.example to .env at the repository root to run them.\n'
		);
		project.provide('testDatabaseUrl', null);
		return;
	}

	const name = `casebook_test_${process.pid}_${Date.now()}`;
	const admin = postgres(url, { max: 1, onnotice: () => {} });
	await admin.unsafe(`CREATE DATABASE "${name}"`);
	const testUrl = new URL(url);
	testUrl.pathname = `/${name}`;
	try {
		await runMigrations(testUrl.toString());
	} catch (error) {
		await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
		await admin.end();
		throw error;
	}
	project.provide('testDatabaseUrl', testUrl.toString());

	return async () => {
		await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
		await admin.end();
	};
}
