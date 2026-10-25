import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import type { TestProject } from 'vitest/node';
import { runMigrations } from '@casebook/store';

declare module 'vitest' {
	export interface ProvidedContext {
		/** A freshly migrated throwaway database, or null when DATABASE_URL is unset. */
		testDatabaseUrl: string | null;
	}
}

// Like @casebook/store's tests: use the repository root .env when present.
const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

/**
 * Creates a throwaway database next to the one DATABASE_URL names for the store-backed tests,
 * migrates it and drops it afterwards. Without DATABASE_URL those tests are skipped, except in CI.
 */
export default async function setup(project: TestProject) {
	const url = process.env.DATABASE_URL;
	if (!url) {
		if (process.env.CI)
			throw new Error('DATABASE_URL must be set in CI; the store-backed tests need Postgres.');
		project.provide('testDatabaseUrl', null);
		return;
	}
	const name = `casebook_wizard_test_${process.pid}_${Date.now()}`;
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
