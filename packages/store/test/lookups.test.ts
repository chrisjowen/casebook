import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDb, type Db } from '../src/client.js';
import { memoryFileStore } from '../src/files.js';
import { runMigrations } from '../src/migrate.js';
import {
	createSharedLookup,
	deleteSharedLookup,
	describeListChanges,
	editSharedLookup,
	listSharedLookups,
	readSharedLookup,
	sharedLookupHistory,
	sharedLookupsFor,
	sharedLookupUses,
	undoSharedLookupEdit,
	type SharedLookup
} from '../src/lookups.js';
import type { Refusal } from '../src/definitions.js';
import {
	completeItem,
	listProcesses,
	loadCase,
	loadTask,
	startCase
} from '../src/runtime/index.js';
import { DEMO_ISSUER, seedDemo } from '../src/seed.js';
import { namespaces, principals } from '../src/schema.js';

const url = inject('testDatabaseUrl');

type Subject = 'olive' | 'devon' | 'wren' | 'rae' | 'alex';

describe('describeListChanges', () => {
	it('says what changed in a shared lookup', () => {
		expect(
			describeListChanges(
				{ title: 'Insurers', values: [{ value: 'a' }] },
				{ title: 'Health insurers', values: [{ value: 'a', code: 'A1' }, { value: 'b' }] }
			)
		).toEqual(['Renamed it to Health insurers', 'Added b; set the code of a to A1']);
	});
});

describe.skipIf(!url)('shared lookups (Postgres)', () => {
	let db: Db;
	const files = memoryFileStore();
	const users = {} as Record<Subject, { id: string }>;
	const ns = new Map<string, string>();

	// The definition tests seed the shared test database, so this suite seeds its own.
	const name = `casebook_lookups_${process.pid}_${Date.now()}`;
	const server = url ? postgres(url, { max: 1, onnotice: () => {} }) : undefined;

	beforeAll(async () => {
		await server!.unsafe(`CREATE DATABASE "${name}"`);
		const own = new URL(url!);
		own.pathname = `/${name}`;
		await runMigrations(own.toString());
		db = createDb(own.toString());
		expect((await seedDemo(db, { files })).seeded).toBe(true);
		const rows = await db
			.select({ id: principals.id, subject: principals.subject })
			.from(principals)
			.where(eq(principals.issuer, DEMO_ISSUER));
		for (const row of rows) users[row.subject as Subject] = { id: row.id };
		for (const n of await db
			.select({ id: namespaces.id, path: namespaces.path })
			.from(namespaces)) {
			ns.set(n.path, n.id);
		}
	});
	afterAll(async () => {
		await db?.$client.end();
		await server?.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
		await server?.end();
	});

	const refused = (result: unknown, code: Refusal['code'], reason?: RegExp) => {
		expect(result).toMatchObject({ ok: false, code });
		if (reason) expect((result as Refusal).reason).toMatch(reason);
	};

	async function lookup(actor: { id: string }, account: string, title: string) {
		const found = (await listSharedLookups(db, actor, account))
			.flatMap((n) => n.lookups)
			.find((l) => l.title === title);
		if (!found) throw new Error(`${title} is not visible`);
		return found;
	}

	it('lists each namespace’s shared lookups with whether the reader may change them', async () => {
		const acme = await listSharedLookups(db, users.olive, 'acme');
		expect(
			acme.map((n) => [n.namespace.path, n.can.edit.allowed, n.lookups.map((l) => l.title)])
		).toEqual([
			['acme', true, []],
			['acme/eng', true, ['Service catalog']],
			['acme/eng/platform', true, []],
			['acme/eng/sre', true, []]
		]);
		const asRae = await listSharedLookups(db, users.rae, 'acme');
		expect(asRae.find((n) => n.namespace.path === 'acme/eng')?.can.edit).toMatchObject({
			allowed: false,
			reason: expect.stringMatching(/cannot change the shared lookups of/)
		});
		const countries = await lookup(users.alex, 'example-family', 'ISO 3166 countries');
		expect(countries.name).toBe('iso-3166-countries');
		expect(countries.values.length).toBe(249);
		expect(countries.values.find((v) => v.code === 'PT')).toEqual({
			value: 'Portugal',
			code: 'PT'
		});
	});

	it('lets a process see the shared lookups of its namespace and those above it', async () => {
		expect([
			...(await sharedLookupsFor(db, await accountOf('acme'), 'acme/eng/sre')).keys()
		]).toEqual(['service-catalog']);
		expect((await sharedLookupsFor(db, await accountOf('acme'), 'acme')).size).toBe(0);
	});

	async function accountOf(slug: string) {
		const all = await listSharedLookups(db, users.olive, slug);
		return all[0]!.namespace.accountId;
	}

	it('lists the processes and facts that choose from a shared lookup', async () => {
		const catalog = await lookup(users.olive, 'acme', 'Service catalog');
		expect(await sharedLookupUses(db, catalog)).toEqual([
			{
				definitionId: expect.any(String),
				slug: 'incident-management',
				title: 'Incident management',
				namespace: 'acme/eng/sre',
				facts: [{ id: 'fact.affected-services', title: 'Affected services' }],
				draftOnly: false
			}
		]);
	});

	it('makes, changes and undoes a shared lookup, one version per change', async () => {
		const made = await createSharedLookup(db, users.wren, {
			namespaceId: ns.get('acme/eng')!,
			title: 'Regions',
			values: [{ value: 'EU' }]
		});
		if (!made.ok) throw new Error(made.reason);
		expect(made).toMatchObject({ name: 'regions', version: 1 });

		const edited = await editSharedLookup(db, users.wren, {
			lookupId: made.id,
			baseVersion: 1,
			changes: { values: [{ value: 'EU', label: 'Europe' }, { value: 'US' }] }
		});
		expect(edited).toMatchObject({ ok: true, version: 2 });
		refused(
			await editSharedLookup(db, users.wren, {
				lookupId: made.id,
				baseVersion: 1,
				changes: { title: 'Areas' }
			}),
			'stale-draft',
			/changed while you were editing/
		);
		refused(
			await editSharedLookup(db, users.wren, {
				lookupId: made.id,
				baseVersion: 2,
				changes: { values: [{ value: 'EU' }, { value: 'EU' }] }
			}),
			'invalid-operation',
			/EU is in the list twice/
		);
		refused(
			await editSharedLookup(db, users.wren, {
				lookupId: made.id,
				baseVersion: 2,
				changes: { title: 'Regions' }
			}),
			'no-change'
		);
		expect(
			await undoSharedLookupEdit(db, users.wren, { lookupId: made.id, baseVersion: 2 })
		).toMatchObject({ ok: true, version: 3 });
		const read = await readSharedLookup(db, users.wren, made.id);
		if (!read.ok) throw new Error(read.reason);
		expect(read.lookup.values).toEqual([{ value: 'EU' }]);
		expect((await sharedLookupHistory(db, made.id)).map((v) => [v.version, v.summary])).toEqual([
			[3, ['Undid changes, back to version 1']],
			[2, ['Added US; renamed EU to Europe']],
			[1, ['Made with 1 value']]
		]);
	});

	it('refuses changes from someone without write on the namespace', async () => {
		const catalog = await lookup(users.rae, 'acme', 'Service catalog');
		refused(
			await editSharedLookup(db, users.rae, {
				lookupId: catalog.id,
				baseVersion: catalog.version,
				changes: { title: 'Services' }
			}),
			'access-denied'
		);
		refused(
			await createSharedLookup(db, users.rae, { namespaceId: ns.get('acme')!, title: 'X' }),
			'access-denied'
		);
	});

	it('deletes a shared lookup only when no process chooses from it', async () => {
		const catalog = await lookup(users.olive, 'acme', 'Service catalog');
		refused(
			await deleteSharedLookup(db, users.olive, catalog.id),
			'referenced',
			/Incident management/
		);
		const spare = await createSharedLookup(db, users.olive, {
			namespaceId: ns.get('acme')!,
			title: 'Spare'
		});
		if (!spare.ok) throw new Error(spare.reason);
		expect(await deleteSharedLookup(db, users.olive, spare.id)).toEqual({ ok: true });
	});

	it('lets a nearer namespace’s list of the same name stand in for a farther one', async () => {
		const near = await createSharedLookup(db, users.olive, {
			namespaceId: ns.get('acme/eng/sre')!,
			title: 'Service catalog',
			values: [{ value: 'pager' }]
		});
		if (!near.ok) throw new Error(near.reason);
		const seen = await sharedLookupsFor(db, await accountOf('acme'), 'acme/eng/sre');
		expect(seen.get('service-catalog')?.values).toEqual([{ value: 'pager' }]);
		const far = await lookup(users.olive, 'acme', 'Service catalog');
		const all = (await listSharedLookups(db, users.olive, 'acme')).flatMap((n) => n.lookups);
		const sre = all.find((l) => l.id === near.id) as SharedLookup;
		expect(await sharedLookupUses(db, sre)).toHaveLength(1);
		expect(
			await sharedLookupUses(
				db,
				all.find((l) => l.namespace.path === 'acme/eng' && l.name === far.name)!
			)
		).toEqual([]);
		expect(await deleteSharedLookup(db, users.olive, near.id)).toMatchObject({ ok: false });
	});
});

describe.skipIf(!url)('choices on case forms (Postgres)', () => {
	let db: Db;
	const files = memoryFileStore();
	const users = {} as Record<Subject, { id: string }>;
	const name = `casebook_choices_${process.pid}_${Date.now()}`;
	const server = url ? postgres(url, { max: 1, onnotice: () => {} }) : undefined;

	beforeAll(async () => {
		await server!.unsafe(`CREATE DATABASE "${name}"`);
		const own = new URL(url!);
		own.pathname = `/${name}`;
		await runMigrations(own.toString());
		db = createDb(own.toString());
		await seedDemo(db, { files });
		const rows = await db
			.select({ id: principals.id, subject: principals.subject })
			.from(principals)
			.where(eq(principals.issuer, DEMO_ISSUER));
		for (const row of rows) users[row.subject as Subject] = { id: row.id };
	});
	afterAll(async () => {
		await db?.$client.end();
		await server?.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
		await server?.end();
	});

	async function incident(title: string) {
		const processes = await listProcesses(db, users.devon, 'acme');
		if ('ok' in processes) throw new Error(processes.reason);
		const definitionId = processes.groups
			.flatMap((g) => g.definitions)
			.find((d) => d.slug === 'incident-management')!.id;
		const started = await startCase(db, users.devon, { definitionId, title });
		if (!started.ok) throw new Error(started.reason);
		return started;
	}

	it('offers a shared lookup’s values by label, and refuses one that is not in it', async () => {
		const { attachmentId, caseId } = await incident('INC-5000 Choices');
		const task = await loadTask(db, users.devon, 'acme', {
			attachmentId,
			item: 'step.report-incident'
		});
		if ('ok' in task) throw new Error(task.reason);
		const services = task.fields.find((f) => f.fact === 'fact.affected-services')!;
		expect(services).toMatchObject({ kind: 'choice', multiple: true });
		expect(services.options?.slice(0, 2)).toEqual([
			{ value: 'api', label: 'Public API', code: 'API' },
			{ value: 'auth-proxy', label: 'Sign-in proxy', code: 'AUTH' }
		]);

		const report = (values: string[]) =>
			completeItem(
				db,
				users.devon,
				{
					attachmentId,
					item: 'step.report-incident',
					values: { 'fact.incident-summary': ['Down'], 'fact.affected-services': values }
				},
				{ files }
			);
		expect(await report(['api', 'mainframe'])).toMatchObject({
			ok: false,
			code: 'invalid-input',
			reason: 'Affected services: "mainframe" is not one of the choices'
		});
		expect(await report(['api', 'checkout-api'])).toMatchObject({ ok: true });

		const severity = await loadTask(db, users.wren, 'acme', {
			attachmentId,
			item: 'decision.classify-severity'
		});
		if ('ok' in severity) throw new Error(severity.reason);
		expect(severity.fields[0]?.options?.map((o) => o.label)).toEqual([
			'SEV1 · Full outage',
			'SEV2 · Major',
			'SEV3 · Minor',
			'SEV4 · Cosmetic'
		]);

		const view = await loadCase(db, users.devon, 'acme', caseId);
		if ('ok' in view) throw new Error(view.reason);
		expect(view.record.find((r) => r.fact === 'fact.affected-services')?.display).toBe(
			'Public API, Checkout API'
		);
	});
});
