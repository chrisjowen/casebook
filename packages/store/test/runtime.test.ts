import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDb, type Db } from '../src/client.js';
import { runMigrations } from '../src/migrate.js';
import { memoryFileStore } from '../src/files.js';
import {
	bindRole,
	createAccount,
	createCase,
	createNamespace,
	grantDelegation
} from '../src/repository.js';
import { publishDefinition } from '../src/definitions.js';
import {
	casebookPeople,
	completeItem,
	decideApproval,
	findCaseFile,
	holdItem,
	listInstances,
	listProcesses,
	loadCase,
	loadGuestTask,
	loadCaseFacts,
	loadProcess,
	loadRequests,
	loadTask,
	loadWork,
	moveToLatest,
	resumeItem,
	skipItem,
	startCase,
	startItem,
	type RuntimeRefusal,
	type TaskSummary,
	type WorkView
} from '../src/runtime/index.js';
import { DEMO_ISSUER, seedDemo } from '../src/seed.js';
import { caseEvents, cases, namespaces, principals } from '../src/schema.js';

const url = inject('testDatabaseUrl');

type Subject = 'olive' | 'devon' | 'wren' | 'rae' | 'alex' | 'sam' | 'dana' | 'insurer' | 'agent';

describe.skipIf(!url)('case runtime (Postgres)', () => {
	let db: Db;
	const files = memoryFileStore();
	const users = {} as Record<Subject, { id: string }>;

	// The definition tests seed the shared test database, so this suite seeds its own.
	const name = `casebook_runtime_${process.pid}_${Date.now()}`;
	const server = url ? postgres(url, { max: 1, onnotice: () => {} }) : undefined;

	beforeAll(async () => {
		await server!.unsafe(`CREATE DATABASE "${name}"`);
		const own = new URL(url!);
		own.pathname = `/${name}`;
		await runMigrations(own.toString());
		db = createDb(own.toString());
		const { seeded } = await seedDemo(db, { files });
		expect(seeded).toBe(true);
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

	async function work(who: Subject, instance: string): Promise<WorkView> {
		const view = await loadWork(db, users[who], instance);
		if ('ok' in view) throw new Error(view.reason);
		return view;
	}
	const titles = (tasks: TaskSummary[]) => tasks.map((t) => `${t.title} · ${t.caseTitle}`);

	function expectRefused(result: unknown, code: RuntimeRefusal['code'], reason?: RegExp) {
		expect(result).toMatchObject({ ok: false, code });
		if (reason) expect((result as RuntimeRefusal).reason).toMatch(reason);
	}

	describe('the seeded casebooks', () => {
		it('lists the casebooks each member belongs to, with what waits on them', async () => {
			expect(await listInstances(db, users.alex)).toMatchObject([
				{ slug: 'acme', name: 'Acme', role: 'read-only', waitingOnYou: 0 },
				{ slug: 'example-family', name: 'Example family', role: 'account-owner', waitingOnYou: 2 }
			]);
			expect(await listInstances(db, users.dana)).toEqual([]);
		});

		it('groups Alex’s family work: ready, paused, and waiting on others', async () => {
			const view = await work('alex', 'example-family');
			expect(titles(view.ready)).toEqual(['Complete the application form · Mira Example']);
			expect(view.ready[0]!.started.map((s) => s.by.name)).toEqual(['Sam Example']);
			expect(view.ready[0]!.stage).toMatchObject({
				number: 2,
				count: 3,
				title: 'Prepare the application'
			});
			expect(titles(view.held)).toEqual(['Upload the marriage certificate · Sam Example']);
			expect(view.held[0]!.held?.note).toMatch(/apostille/);
			expect(
				view.waiting.map((w) => [w.process, w.on.map((o) => `${o.holders[0]?.name} — ${o.title}`)])
			).toEqual([
				['Claim a medical bill · Delivery bill', ['Dana Cole — Send the itemised invoice']],
				['Claim a medical bill · Physio sessions', ['Example Health Insurance — Assess the claim']]
			]);
			expect(view.recurring).toEqual([]);
		});

		it('puts repeating work in its own quiet group', async () => {
			const view = await work('alex', 'acme');
			expect(view.ready).toEqual([]);
			expect(titles(view.recurring)).toEqual(['Post a status update · INC-2041 Checkout latency']);
			expect(view.recurring[0]).toMatchObject({ repeating: true, overdue: true });
		});

		it('shows the incident commander and the director their own queues', async () => {
			const wren = await work('wren', 'acme');
			expect(titles(wren.ready).sort()).toEqual([
				'Classify severity · INC-2043 Search indexing delay',
				'Resolve the incident · INC-2041 Checkout latency'
			]);
			expect(wren.waiting.map((w) => [w.caseTitle, w.on[0]?.holders[0]?.name])).toEqual([
				['INC-2038 Login errors', 'Olive Owner']
			]);
			const olive = await work('olive', 'acme');
			expect(titles(olive.ready)).toEqual(['Sign off the RCA · INC-2038 Login errors']);
			const rae = await work('rae', 'acme');
			expect([...rae.ready, ...rae.held, ...rae.recurring, ...rae.waiting]).toEqual([]);
			expect(rae.cases).toHaveLength(3);
		});

		it('refuses a casebook the user is not a member of', async () => {
			expect(await loadWork(db, users.rae, 'example-family')).toMatchObject({
				ok: false,
				code: 'access-denied'
			});
			expect(await loadWork(db, users.dana, 'example-family')).toMatchObject({ ok: false });
		});
	});

	describe('a case', () => {
		it('shows each process’s stages, what others are doing, and the record with provenance', async () => {
			const view = await work('alex', 'example-family');
			const caseId = view.cases.find((c) => c.title === 'Mira Example')!.id;
			const c = await loadCase(db, users.alex, 'example-family', caseId);
			if ('ok' in c) throw new Error(c.reason);
			expect(c.processes.map((p) => [p.name, p.line.number, p.line.title])).toEqual([
				['Register a birth abroad', 2, 'Prepare the application'],
				['Claim a medical bill · Delivery bill', 1, 'Collect the bill']
			]);
			expect(c.processes[1]!.others).toBe(
				'Your part is done for now. Waiting on Dana Cole — send the itemised invoice.'
			);
			const certificate = c.record.find(
				(r) => r.fact === 'fact.local-birth-certificate' && !r.evidence
			)!;
			expect(certificate).toMatchObject({
				display: 'BC-2026-004417',
				by: { name: 'Alex Example' },
				from: { title: 'Register the birth locally', process: 'Register a birth abroad' }
			});
			const patient = c.record.find((r) => r.fact === 'fact.patient-name')!;
			expect(patient.display).toBe('Mira Example');
			const files = c.record.filter((r) => r.file);
			expect(files.map((f) => f.file!.name).sort()).toEqual([
				'birth-certificate-scan.pdf',
				'hospital-notification.pdf'
			]);
			expect(c.record.find((r) => r.fact === 'fact.date-of-birth')!.display).toBe('12 Sept 2026');
		});

		it('is closed to members who cannot read it and to guests', async () => {
			const view = await work('alex', 'example-family');
			const caseId = view.cases[0]!.id;
			expect(await loadCase(db, users.dana, 'example-family', caseId)).toMatchObject({ ok: false });
			expect(await loadCase(db, users.rae, 'acme', caseId)).toMatchObject({ ok: false });
		});
	});

	describe('guests', () => {
		it('see only the forms addressed to them, with one line of context and who asked', async () => {
			const requests = await loadRequests(db, users.dana);
			expect(requests).toEqual([
				expect.objectContaining({
					title: 'Send the itemised invoice',
					status: 'ready',
					requester: 'Alex Example',
					forWhom: 'Mira Example',
					from: 'Example family'
				})
			]);
		});

		it('get only the values their form uses, nothing else about the case', async () => {
			const [request] = await loadRequests(db, users.dana);
			const task = await loadGuestTask(db, users.dana, request!);
			if ('ok' in task) throw new Error(task.reason);
			expect(task.uses.map((u) => [u.title, u.recorded?.display])).toEqual([
				['Patient name', 'Mira Example'],
				['Date of treatment', '12 Sept 2026']
			]);
			expect(task.fields.map((f) => [f.title, f.kind])).toEqual([
				['Itemised invoice', 'file'],
				['Amount billed', 'number']
			]);
			expect(task.requester?.name).toBe('Alex Example');
			expect(task.uses.map((u) => u.recorded?.by)).toEqual([undefined, undefined]);
			expect(task.you).toEqual({
				canAct: true,
				reason: 'This form was sent to you.',
				role: 'Care provider',
				others: []
			});
			const payload = JSON.stringify(task);
			expect(payload.split('Alex Example')).toHaveLength(2);
			expect(payload).not.toContain('BC-2026-004417');
			expect(payload).not.toContain('Riverside Hospital');
			expect(payload).not.toContain('Sam Example');
			expect(task.case.id).toBe('');
			// A member's view of a task is not for guests.
			expect(await loadTask(db, users.dana, 'example-family', request!)).toMatchObject({
				ok: false
			});
			// And a guest cannot open someone else's form.
			const view = await work('alex', 'example-family');
			expect(await loadGuestTask(db, users.dana, view.ready[0]!)).toMatchObject({ ok: false });
		});

		it('complete their form, which moves the case on for the requester', async () => {
			const [request] = await loadRequests(db, users.dana);
			const done = await completeItem(
				db,
				users.dana,
				{
					...request!,
					values: { 'fact.amount-billed': ['1 840'] },
					files: [
						{
							slot: 'fact:fact.itemised-invoice',
							name: 'invoice.pdf',
							contentType: 'application/pdf',
							bytes: new TextEncoder().encode('%PDF-1.4 invoice')
						}
					]
				},
				{ files }
			);
			expect(done).toMatchObject({
				ok: true,
				recorded: ['fact.itemised-invoice', 'fact.amount-billed']
			});
			expect((await loadRequests(db, users.dana))[0]!.status).toBe('done');
			const view = await work('alex', 'example-family');
			expect(titles(view.ready)).toContain('Submit the claim · Mira Example');
			const caseId = view.cases.find((c) => c.title === 'Mira Example')!.id;
			const c = await loadCase(db, users.alex, 'example-family', caseId);
			if ('ok' in c) throw new Error(c.reason);
			expect(c.record.find((r) => r.fact === 'fact.amount-billed')!.display).toBe('€1,840.00');
			const invoice = c.record.find((r) => r.fact === 'fact.itemised-invoice')!;
			expect(invoice.by.name).toBe('Dana Cole');
			const file = await findCaseFile(db, users.dana, invoice.file!.id);
			expect(file).toMatchObject({ name: 'invoice.pdf' });
			const birthCertificate = c.record.find((r) => r.file?.name === 'birth-certificate-scan.pdf')!;
			expect(await findCaseFile(db, users.dana, birthCertificate.file!.id)).toMatchObject({
				ok: false
			});
			expect(await findCaseFile(db, users.alex, birthCertificate.file!.id)).toMatchObject({
				name: 'birth-certificate-scan.pdf'
			});
		});
	});

	describe('working a case', () => {
		async function newIncident(title: string) {
			const processes = await listProcesses(db, users.devon, 'acme');
			if ('ok' in processes) throw new Error(processes.reason);
			const incident = processes.groups
				.flatMap((g) => g.definitions)
				.find((d) => d.slug === 'incident-management')!;
			const started = await startCase(db, users.devon, { definitionId: incident.id, title });
			if (!started.ok) throw new Error(started.reason);
			return { ...started, definitionId: incident.id };
		}
		const ref = (attachmentId: string, item: string) => ({ attachmentId, item });

		it('starts a case of a published process for writers and role holders, and nobody else', async () => {
			const { definitionId } = await newIncident('INC-3000 Start rules');
			expect((await startCase(db, users.wren, { definitionId, title: 'INC-3001' })).ok).toBe(true);
			expectRefused(
				await startCase(db, users.rae, { definitionId, title: 'INC-3002' }),
				'access-denied',
				/cannot start a case of definition "incident-management".*one of its roles/
			);
			expectRefused(await startCase(db, users.devon, { definitionId }), 'invalid-input', /name/);
		});

		it('never lets a role held only on a case, a guest’s included, start a case', async () => {
			const processes = await listProcesses(db, users.alex, 'example-family');
			if ('ok' in processes) throw new Error(processes.reason);
			const id = (slug: string) =>
				processes.groups.flatMap((g) => g.definitions).find((d) => d.slug === slug)!.id;
			expectRefused(
				await startCase(db, users.sam, {
					definitionId: id('birth-registration-abroad'),
					title: 'Another birth'
				}),
				'access-denied',
				/cannot start a case of/
			);
			expectRefused(
				await startCase(db, users.dana, {
					definitionId: id('medical-bill-claim'),
					title: 'A bill of my own',
					roles: { 'role.claimant': [users.alex.id] }
				}),
				'access-denied',
				/cannot start a case of/
			);
		});

		it('moves through stages, skips by guard, and waits on whoever records what is missing', async () => {
			const { attachmentId, caseId } = await newIncident('INC-3010 Stages');
			const stage = async () => {
				const c = await loadCase(db, users.devon, 'acme', caseId);
				if ('ok' in c) throw new Error(c.reason);
				return c.processes[0]!;
			};
			expect((await stage()).line).toMatchObject({ number: 1, title: 'Detect' });

			const wrenEarly = await loadTask(
				db,
				users.wren,
				'acme',
				ref(attachmentId, 'decision.classify-severity')
			);
			if ('ok' in wrenEarly) throw new Error(wrenEarly.reason);
			expect(wrenEarly.task).toMatchObject({
				status: 'waiting',
				waitingOn: { title: 'Report the incident', holders: [{ name: 'Devon Developer' }] }
			});
			expectRefused(
				await completeItem(
					db,
					users.wren,
					{
						...ref(attachmentId, 'decision.classify-severity'),
						values: { 'fact.severity': ['SEV4'] }
					},
					{ files }
				),
				'not-ready'
			);

			expect(
				await completeItem(
					db,
					users.devon,
					{
						...ref(attachmentId, 'step.report-incident'),
						values: { 'fact.incident-summary': ['Slow'], 'fact.affected-services': ['api'] }
					},
					{ files }
				)
			).toMatchObject({ ok: true });
			expectRefused(
				await completeItem(
					db,
					users.wren,
					{
						...ref(attachmentId, 'decision.classify-severity'),
						values: { 'fact.severity': ['SEV9'] }
					},
					{ files }
				),
				'invalid-input',
				/Severity: must be one of SEV1 · Full outage, SEV2 · Major, SEV3 · Minor, SEV4 · Cosmetic/
			);
			await completeItem(
				db,
				users.wren,
				{
					...ref(attachmentId, 'decision.classify-severity'),
					values: { 'fact.severity': ['SEV4'] }
				},
				{ files }
			);
			const after = await stage();
			expect(after.line).toMatchObject({ number: 3, title: 'Resolve' });
			expect(after.items.find((i) => i.id === 'step.form-working-group')!.status).toBe('skipped');

			const events = await db
				.select({ type: caseEvents.type, data: caseEvents.data })
				.from(caseEvents)
				.where(eq(caseEvents.caseId, caseId));
			expect(events.map((e) => e.type)).toEqual(
				expect.arrayContaining([
					'case.opened',
					'process.started',
					'decision.made',
					'fact.recorded',
					'stage.completed',
					'stage.entered'
				])
			);
		});

		it('lets the first to finish win, and tells the second who did', async () => {
			const { attachmentId } = await newIncident('INC-3020 Race');
			const report = (who: Subject) =>
				completeItem(
					db,
					users[who],
					{
						...ref(attachmentId, 'step.report-incident'),
						values: { 'fact.incident-summary': [who], 'fact.affected-services': ['api'] }
					},
					{ files }
				);
			expect(
				await startItem(db, users.devon, ref(attachmentId, 'step.report-incident'))
			).toMatchObject({ ok: true });
			const results = await Promise.all([report('devon'), report('devon')]);
			expect(results.filter((r) => r.ok)).toHaveLength(1);
			expectRefused(
				results.find((r) => !r.ok),
				'already-done',
				/Devon Developer finished it first/
			);
		});

		it('pauses and resumes a task, noting why', async () => {
			const { attachmentId } = await newIncident('INC-3030 Pause');
			const item = ref(attachmentId, 'step.report-incident');
			expectRefused(await holdItem(db, users.devon, { ...item, note: ' ' }), 'invalid-input');
			await holdItem(db, users.devon, { ...item, note: 'Waiting for the dashboards' });
			const held = await loadTask(db, users.devon, 'acme', item);
			if ('ok' in held) throw new Error(held.reason);
			expect(held.task).toMatchObject({
				status: 'held',
				held: { note: 'Waiting for the dashboards' }
			});
			await resumeItem(db, users.devon, item);
			const resumed = await loadTask(db, users.devon, 'acme', item);
			expect(resumed).toMatchObject({ task: { status: 'ready' } });
		});

		it('refuses work to people without the role, and human-only work to agents', async () => {
			const { attachmentId } = await newIncident('INC-3040 Roles');
			const item = ref(attachmentId, 'step.report-incident');
			expectRefused(
				await completeItem(db, users.rae, { ...item, values: {} }, { files }),
				'access-denied',
				/cannot act as role.on-call-engineer/
			);
			expectRefused(await holdItem(db, users.alex, { ...item, note: 'x' }), 'access-denied');
			const agent = { id: users.agent.id, onBehalfOfId: users.alex.id };
			expectRefused(
				await completeItem(
					db,
					agent,
					{ ...ref(attachmentId, 'step.resolve-incident'), values: {} },
					{ files }
				),
				'access-denied'
			);
		});

		it('takes approvals from a person only, never the one who did the work, and can send work back', async () => {
			const { attachmentId, caseId } = await newIncident('INC-3050 Review');
			const done = (
				who: { id: string; onBehalfOfId?: string },
				item: string,
				values: Record<string, string[]>,
				uploads = false
			) =>
				completeItem(
					db,
					who,
					{
						...ref(attachmentId, item),
						values,
						...(uploads
							? {
									files: [
										{
											slot: 'fact:fact.rca-document',
											name: 'rca.md',
											contentType: 'text/markdown',
											bytes: new TextEncoder().encode('# RCA')
										}
									]
								}
							: {})
					},
					{ files }
				);
			await done(users.devon, 'step.report-incident', {
				'fact.incident-summary': ['x'],
				'fact.affected-services': ['api']
			});
			await done(users.wren, 'decision.classify-severity', { 'fact.severity': ['SEV3'] });
			await done(users.wren, 'step.resolve-incident', {
				'fact.resolution-summary': ['Fixed'],
				'fact.resolved-at': ['2026-10-25T10:00:00Z']
			});
			await done({ id: users.agent.id, onBehalfOfId: users.alex.id }, 'step.notify-downstream', {
				'fact.downstream-notified': ['yes']
			});
			expect(await done(users.wren, 'step.write-rca', {}, true)).toMatchObject({ ok: true });

			const approval = ref(attachmentId, 'approval.rca-sign-off');
			expectRefused(
				await decideApproval(db, users.wren, { ...approval, approve: true }),
				'access-denied',
				/cannot act as role.engineering-director/
			);
			expectRefused(
				await decideApproval(
					db,
					{ id: users.agent.id, onBehalfOfId: users.olive.id },
					{ ...approval, approve: true }
				),
				'access-denied'
			);
			expectRefused(
				await decideApproval(db, users.olive, { ...approval, approve: false }),
				'invalid-input',
				/what needs to change/
			);
			expect(
				await decideApproval(db, users.olive, {
					...approval,
					approve: false,
					note: 'Add a timeline'
				})
			).toMatchObject({ ok: true });
			const sentBack = await loadTask(db, users.wren, 'acme', ref(attachmentId, 'step.write-rca'));
			expect(sentBack).toMatchObject({
				task: { status: 'ready', sentBack: { by: { name: 'Olive Owner' }, note: 'Add a timeline' } }
			});

			await done(users.wren, 'step.write-rca', {}, true);
			expect(await decideApproval(db, users.olive, { ...approval, approve: true })).toMatchObject({
				ok: true
			});
			const c = await loadCase(db, users.wren, 'acme', caseId);
			if ('ok' in c) throw new Error(c.reason);
			expect(c.processes[0]).toMatchObject({ complete: true, line: { title: 'Finished' } });
		});

		it('stops someone approving work they did themselves, even holding both roles', async () => {
			const { attachmentId, caseId } = await newIncident('INC-3060 Self review');
			const done = (item: string, values: Record<string, string[]>, who: Subject = 'wren') =>
				completeItem(db, users[who], { ...ref(attachmentId, item), values }, { files });
			await done(
				'step.report-incident',
				{ 'fact.incident-summary': ['x'], 'fact.affected-services': ['api'] },
				'devon'
			);
			await done('decision.classify-severity', { 'fact.severity': ['SEV3'] });
			await done('step.resolve-incident', {
				'fact.resolution-summary': ['Fixed'],
				'fact.resolved-at': ['2026-10-25T10:00:00Z']
			});
			await completeItem(
				db,
				users.wren,
				{
					...ref(attachmentId, 'step.write-rca'),
					files: [
						{
							slot: 'fact:fact.rca-document',
							name: 'rca.md',
							contentType: 'text/markdown',
							bytes: new TextEncoder().encode('# RCA')
						}
					]
				},
				{ files }
			);
			const [where] = await db
				.select({ accountId: namespaces.accountId, namespaceId: namespaces.id })
				.from(cases)
				.innerJoin(namespaces, eq(namespaces.id, cases.namespaceId))
				.where(eq(cases.id, caseId));
			const { accountId, namespaceId } = where!;
			await bindRole(db, {
				principalId: users.wren.id,
				role: 'role.engineering-director',
				accountId,
				namespaceId,
				caseId
			});
			expectRefused(
				await decideApproval(db, users.wren, {
					...ref(attachmentId, 'approval.rca-sign-off'),
					approve: true
				}),
				'access-denied',
				/Nobody approves their own work/
			);
		});

		it('lets a step’s role skip it when its condition is prose only, saying why', async () => {
			const { attachmentId, caseId } = await newIncident('INC-3070 Skip');
			expectRefused(
				await skipItem(db, users.devon, {
					...ref(attachmentId, 'step.report-incident'),
					reason: 'n/a'
				}),
				'not-ready',
				/always applies/
			);
			const done = (item: string, values: Record<string, string[]>, who: Subject = 'wren') =>
				completeItem(db, users[who], { ...ref(attachmentId, item), values }, { files });
			await done(
				'step.report-incident',
				{ 'fact.incident-summary': ['x'], 'fact.affected-services': ['api'] },
				'devon'
			);
			await done('decision.classify-severity', { 'fact.severity': ['SEV4'] });
			await done('step.resolve-incident', {
				'fact.resolution-summary': ['Typo'],
				'fact.resolved-at': ['2026-10-25T10:00:00Z']
			});
			const rca = ref(attachmentId, 'step.write-rca');
			const task = await loadTask(db, users.wren, 'acme', rca);
			expect(task).toMatchObject({ canSkip: true, guard: { state: 'open' } });
			expectRefused(await skipItem(db, users.wren, { ...rca, reason: '' }), 'invalid-input');
			expect(
				await skipItem(db, users.wren, { ...rca, reason: 'A SEV4 typo needs no RCA' })
			).toMatchObject({ ok: true });
			const c = await loadCase(db, users.wren, 'acme', caseId);
			if ('ok' in c) throw new Error(c.reason);
			const items = c.processes[0]!.items;
			expect(items.find((i) => i.id === 'step.write-rca')).toMatchObject({
				status: 'skipped',
				skipped: { reason: 'A SEV4 typo needs no RCA' }
			});
			expect(items.find((i) => i.id === 'approval.rca-sign-off')!.status).toBe('skipped');
		});
	});

	describe('processes', () => {
		it('lists each instance’s processes with status, version, policy, live cases and draft changes', async () => {
			const view = await listProcesses(db, users.alex, 'example-family');
			if ('ok' in view) throw new Error(view.reason);
			const rows = view.groups.flatMap((g) => g.definitions);
			expect(rows.map((r) => [r.title, r.status, r.version, r.policy, r.draftPending])).toEqual([
				['Register a birth abroad', 'published', 1, 'living', false],
				['Claim a medical bill', 'published', 1, 'living', false],
				['Spouse citizenship', 'published', 1, 'governed', true]
			]);
			expect(rows.find((r) => r.slug === 'medical-bill-claim')!.liveCases).toBe(2);
			expect(rows.every((r) => r.can.start.allowed && r.can.edit.allowed)).toBe(true);

			const process = await loadProcess(db, users.alex, 'example-family', 'spouse-citizenship');
			if ('ok' in process) throw new Error(process.reason);
			expect(process.cases.map((c) => [c.title, c.attachment.binding])).toEqual([
				['Sam Example', 'pinned']
			]);
		});

		it('gives the facts on each case running a process, for testing its conditions', async () => {
			const found = await loadCaseFacts(db, users.alex, 'example-family', 'medical-bill-claim');
			if (!found.ok) throw new Error(found.reason);
			expect(found.cases).toHaveLength(2);
			for (const c of found.cases) {
				expect(c.title).toEqual(expect.any(String));
				expect(Object.keys(c.facts).every((f) => f.startsWith('fact.'))).toBe(true);
			}
			expect(found.cases.some((c) => Object.keys(c.facts).length > 0)).toBe(true);
			expect(
				await loadCaseFacts(db, users.alex, 'example-family', 'no-such-process')
			).toMatchObject({ ok: false, code: 'not-found' });
		});

		it('moves a pinned case to a newer version only by an explicit move, for writers', async () => {
			const before = await loadProcess(db, users.alex, 'example-family', 'spouse-citizenship');
			if ('ok' in before) throw new Error(before.reason);
			const published = await publishDefinition(db, users.alex, {
				definitionId: before.process.id,
				baseRevision: 2
			});
			expect(published).toMatchObject({ ok: true });
			const pinned = await loadProcess(db, users.alex, 'example-family', 'spouse-citizenship');
			if ('ok' in pinned) throw new Error(pinned.reason);
			const run = pinned.cases[0]!.attachment;
			expect(run).toMatchObject({ binding: 'pinned', version: 1, latestVersion: 2 });
			expect(pinned.process).toMatchObject({ version: 2, draftPending: false });

			expectRefused(
				await moveToLatest(db, users.sam, run.id),
				'access-denied',
				/move the bound version/
			);
			expect(await moveToLatest(db, users.alex, run.id)).toEqual({ ok: true, version: 2 });
			const moved = await loadProcess(db, users.alex, 'example-family', 'spouse-citizenship');
			if ('ok' in moved) throw new Error(moved.reason);
			expect(moved.cases[0]!.attachment.version).toBe(2);
			expectRefused(await moveToLatest(db, users.alex, run.id), 'invalid-input', /newer version/);
		});

		it('names the people a member can put on a case, guests included, and nobody else', async () => {
			const people = await casebookPeople(db, users.alex, 'example-family');
			expect(Array.isArray(people) && people.map((p) => p.name)).toEqual([
				'Alex Example',
				'Dana Cole',
				'Example Health Insurance',
				'Sam Example'
			]);
			expect(await casebookPeople(db, users.dana, 'example-family')).toMatchObject({ ok: false });
		});

		it('lets read-only members browse and start, but not edit', async () => {
			const view = await listProcesses(db, users.alex, 'acme');
			if ('ok' in view) throw new Error(view.reason);
			const incident = view.groups
				.flatMap((g) => g.definitions)
				.find((d) => d.slug === 'incident-management')!;
			expect(incident.can.edit.allowed).toBe(false);
			expect(incident.can.start).toMatchObject({
				allowed: true,
				reason: expect.stringMatching(/communications-lead, a role in this process/)
			});
			expect(await listProcesses(db, users.dana, 'example-family')).toMatchObject({ ok: false });
		});
	});

	describe('guests, on other cases', () => {
		it('see nothing of who else works the case while their form waits', async () => {
			const processes = await listProcesses(db, users.alex, 'example-family');
			if ('ok' in processes) throw new Error(processes.reason);
			const claim = processes.groups
				.flatMap((g) => g.definitions)
				.find((d) => d.slug === 'medical-bill-claim')!;
			const started = await startCase(db, users.alex, {
				definitionId: claim.id,
				title: 'Follow-up visit',
				roles: { 'role.claimant': [users.sam.id], 'role.care-provider': [users.dana.id] }
			});
			if (!started.ok) throw new Error(started.reason);
			const held = await holdItem(db, users.sam, {
				attachmentId: started.attachmentId,
				item: 'step.request-invoice',
				note: 'Checking the visit date with the clinic'
			});
			expect(held).toMatchObject({ ok: true });
			const request = (await loadRequests(db, users.dana)).find(
				(r) => r.attachmentId === started.attachmentId
			)!;
			expect(request.status).toBe('waiting');
			const task = await loadGuestTask(db, users.dana, request);
			if ('ok' in task) throw new Error(task.reason);
			expect(task.task.status).toBe('waiting');
			expect(task.requester?.name).toBe('Alex Example');
			const payload = JSON.stringify(task);
			expect(payload).not.toContain('Sam Example');
			expect(payload).not.toContain(users.sam.id);
			expect(payload).not.toContain('Checking the visit date');
			expect(payload).not.toContain('Ask the provider for an itemised bill');
			expect(task.task).not.toHaveProperty('waitingOn');
			expect(task.task).not.toHaveProperty('held');
		});

		it('are not counted as holders by a role they hold in another account', async () => {
			const before = (await loadRequests(db, users.dana)).map((r) => r.forWhom).sort();
			expect(before).not.toContain('Sam Example');
			const other = await createAccount(db, {
				slug: 'riverside',
				displayName: 'Riverside',
				createdById: users.olive.id
			});
			const personal = await createNamespace(db, {
				accountId: other.id,
				path: 'personal',
				createdById: users.olive.id
			});
			await bindRole(db, {
				principalId: users.dana.id,
				role: 'role.care-provider',
				accountId: other.id,
				namespaceId: personal.id
			});
			await createCase(db, { namespaceId: personal.id, title: 'Riverside intake' });
			expect((await loadRequests(db, users.dana)).map((r) => r.forWhom).sort()).toEqual(before);
		});
	});

	describe('agents', () => {
		it('see only the case a case-limited delegation covers', async () => {
			const view = await work('sam', 'example-family');
			const mira = view.cases.find((c) => c.title === 'Mira Example')!;
			expect(view.cases.length).toBeGreaterThan(1);
			const [row] = await db
				.select({ namespaceId: cases.namespaceId })
				.from(cases)
				.where(eq(cases.id, mira.id));
			await grantDelegation(db, {
				delegatorId: users.sam.id,
				agentId: users.agent.id,
				namespaceId: row!.namespaceId,
				caseId: mira.id,
				expiresAt: new Date(Date.now() + 86_400_000)
			});
			const agentView = await loadWork(
				db,
				{ id: users.agent.id, onBehalfOfId: users.sam.id },
				'example-family'
			);
			if ('ok' in agentView) throw new Error(agentView.reason);
			expect(agentView.cases.map((c) => c.id)).toEqual([mira.id]);
		});
	});
});
