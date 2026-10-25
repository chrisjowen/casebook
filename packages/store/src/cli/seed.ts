// `pnpm db:seed`: migrates the database DATABASE_URL names, then loads the demo data.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDb } from '../client.js';
import { filesDirectory, localFileStore } from '../files.js';
import { runMigrations } from '../migrate.js';
import { DEMO_ACCOUNT, seedDemo } from '../seed.js';

// Like drizzle.config.ts: read the repository root .env when present.
const rootEnv = fileURLToPath(new URL('../../../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const url = process.env.DATABASE_URL;
if (!url) {
	console.error('DATABASE_URL is not set; copy .env.example to .env at the repository root.');
	process.exit(1);
}

await runMigrations(url);
const db = createDb(url);
try {
	const files = filesDirectory();
	const { seeded, users } = await seedDemo(db, { files: localFileStore(files) });
	if (seeded) {
		console.log(`Seeded the demo casebooks with ${users.length} demo users:`);
		for (const u of users) console.log(`  ${u.displayName}`);
		console.log(`Demo case files are in ${files}.`);
		console.log('Run `pnpm dev` and sign in as one of them.');
	} else {
		console.log(
			`Account "${DEMO_ACCOUNT}" already exists, so nothing was seeded. ` +
				'To start again, run `docker compose down -v`, then `pnpm db:up` and `pnpm db:seed`.'
		);
	}
} finally {
	await db.$client.end();
}
