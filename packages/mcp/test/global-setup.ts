import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
	export interface ProvidedContext {
		/** The Postgres server DATABASE_URL names, or null when it is unset. */
		databaseUrl: string | null;
	}
}

// Like the store's tests: use the repository root .env when present.
const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnv)) {
	process.loadEnvFile(rootEnv);
}

/** Each suite makes its own throwaway database on this server, so dev data is never touched. */
export default function setup(project: TestProject) {
	const url = process.env.DATABASE_URL;
	if (!url && process.env.CI) {
		const message = 'DATABASE_URL must be set in CI; the MCP tests need Postgres.';
		console.error(`\n@casebook/mcp: ${message}\n`);
		throw new Error(message);
	}
	if (!url) {
		console.warn(
			'\n@casebook/mcp: DATABASE_URL is not set, so the database tests are skipped.\n' +
				'Run `pnpm db:up` and copy .env.example to .env at the repository root to run them.\n'
		);
	}
	project.provide('databaseUrl', url ?? null);
}
