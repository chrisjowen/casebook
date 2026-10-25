// A seeded demo world in a throwaway database, and agents signed in as its users.
import { and, eq } from 'drizzle-orm';
import postgres from 'postgres';
import {
	createDb,
	createPrincipal,
	DEMO_ISSUER,
	grantDelegation,
	memoryFileStore,
	runMigrations,
	schema,
	seedDemo,
	type Actor,
	type Db
} from '@casebook/store';

export type Subject = 'olive' | 'devon' | 'wren' | 'rae' | 'alex' | 'sam' | 'dana' | 'insurer';

export interface World {
	db: Db;
	url: string;
	files: ReturnType<typeof memoryFileStore>;
	users: Record<Subject, { id: string }>;
	close(): Promise<void>;
}

export async function demoWorld(serverUrl: string, label: string): Promise<World> {
	const name = `casebook_mcp_${label}_${process.pid}_${Date.now()}`;
	const admin = postgres(serverUrl, { max: 1, onnotice: () => {} });
	await admin.unsafe(`CREATE DATABASE "${name}"`);
	const own = new URL(serverUrl);
	own.pathname = `/${name}`;
	await runMigrations(own.toString());
	const db = createDb(own.toString());
	const files = memoryFileStore();
	await seedDemo(db, { files });
	const rows = await db
		.select({ id: schema.principals.id, subject: schema.principals.subject })
		.from(schema.principals)
		.where(and(eq(schema.principals.issuer, DEMO_ISSUER), eq(schema.principals.kind, 'user')));
	const users = Object.fromEntries(rows.map((r) => [r.subject, { id: r.id }])) as World['users'];
	return {
		db,
		url: own.toString(),
		files,
		users,
		async close() {
			await db.$client.end();
			await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
			await admin.end();
		}
	};
}

/** An agent signed in as the user: an agent principal holding an open delegation from them. */
export async function agentFor(db: Db, userId: string, name = 'Test agent'): Promise<Actor> {
	const agent = await createPrincipal(db, {
		kind: 'agent',
		displayName: name,
		issuer: 'casebook-mcp-test',
		subject: `agent:${userId}:${Math.random()}`
	});
	await grantDelegation(db, {
		delegatorId: userId,
		agentId: agent.id,
		expiresAt: new Date(Date.now() + 3_600_000)
	});
	return { id: agent.id, onBehalfOfId: userId };
}
