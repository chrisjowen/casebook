import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

/** The committed migrations, which ship next to `src` and `dist`. */
export const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

/** Applies every pending migration to the database at `url`. */
export async function runMigrations(url: string): Promise<void> {
	const client = postgres(url, { max: 1, onnotice: () => {} });
	try {
		await migrate(drizzle(client), { migrationsFolder });
	} finally {
		await client.end();
	}
}
