import { Client, InMemoryTransport, type CallToolResult } from '@modelcontextprotocol/client';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
	completeItem,
	decideApproval,
	revokeDelegation,
	schema,
	type Actor
} from '@casebook/store';
import { casebookServer } from '../src/tools.js';
import { agentFor, demoWorld, type Subject, type World } from './world.js';

const url = inject('databaseUrl');

type Body = Record<string, unknown> & { refused?: string; reason?: string };

describe.skipIf(!url)('MCP tools (Postgres)', () => {
	let world: World;
	const agents = {} as Record<Subject, Actor>;
	const clients: Client[] = [];

	beforeAll(async () => {
		world = await demoWorld(url!, 'tools');
		for (const [subject, user] of Object.entries(world.users)) {
			agents[subject as Subject] = await agentFor(world.db, user.id);
		}
	});
	afterAll(async () => {
		await Promise.all(clients.map((c) => c.close()));
		await world?.close();
	});

	/** Calls a tool as the agent signed in as this user, over an in-memory MCP connection. */
	async function call(who: Subject | Actor, name: string, args: Record<string, unknown> = {}) {
		const result = await raw(who, name, args);
		const text = (result.content[0] as { text: string }).text;
		return { error: result.isError === true, body: JSON.parse(text) as Body };
	}

	async function raw(who: Subject | Actor, name: string, args: Record<string, unknown>) {
		const actor = typeof who === 'string' ? agents[who] : who;
		const server = casebookServer({ db: world.db, files: world.files, actor });
		const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
		await server.connect(serverSide);
		const client = new Client({ name: 'test', version: '0.0.0' });
		await client.connect(clientSide);
		clients.push(client);
		return (await client.callTool({ name, arguments: args })) as CallToolResult;
	}

	async function newIncident(title: string) {
		const { error, body } = await call('devon', 'start_case', {
			casebook: 'acme',
			process: 'incident-management',
			title
		});
		expect(error).toBe(false);
		return body as { caseId: string; attachmentId: string };
	}

	const eventsOn = (caseId: string) =>
		world.db.select().from(schema.caseEvents).where(eq(schema.caseEvents.caseId, caseId));

	describe('as a member', () => {
		it('lists the casebooks and work of the user the agent acts for', async () => {
			const { body } = await call('alex', 'list_my_work');
			expect(body.signedIn).toEqual({
				as: 'Alex Example',
				userId: world.users.alex.id,
				agent: 'Test agent'
			});
			expect(body.casebooks).toMatchObject([
				{ casebook: 'acme', yourAccountRole: 'read-only' },
				{ casebook: 'example-family', yourAccountRole: 'account-owner', waitingOnYou: 2 }
			]);
			expect(body.requestsForYouAsAGuest).toEqual([]);

			const { body: work } = await call('alex', 'list_my_work', { casebook: 'example-family' });
			const ready = work.readyForYou as { title: string; case: { title: string } }[];
			expect(ready.map((t) => `${t.title} · ${t.case.title}`)).toEqual([
				'Complete the application form · Mira Example'
			]);
			expect((work.needsInformation as { paused: { note: string } }[])[0]!.paused.note).toMatch(
				/apostille/
			);
		});

		it('reads a process stage by stage, and says approvals are for people', async () => {
			const { body } = await call('devon', 'read_process', {
				casebook: 'acme',
				process: 'incident-management'
			});
			const stages = body.stages as { title: string; items: Record<string, unknown>[] }[];
			expect(stages[0]!.items[0]).toMatchObject({
				item: 'step.report-incident',
				role: expect.any(String),
				records: expect.arrayContaining([expect.any(String)])
			});
			const items = stages.flatMap((s) => s.items);
			expect(items.find((i) => i.item === 'approval.rca-sign-off')).toMatchObject({
				kind: 'approval',
				doneBy: 'a person, never an agent'
			});
			expect(body.youCanStartACase).toBe(true);
		});

		it('inspects a case: stage strips, what others are doing, and the record', async () => {
			const { body: work } = await call('sam', 'list_my_work', { casebook: 'example-family' });
			const mira = (work.cases as { id: string; title: string }[]).find(
				(c) => c.title === 'Mira Example'
			)!;
			const { body } = await call('sam', 'inspect_case', {
				casebook: 'example-family',
				case_id: mira.id
			});
			const processes = body.processes as { stages: unknown[]; othersAreDoing: string }[];
			expect(processes.length).toBeGreaterThan(0);
			expect(processes[0]!.stages).toEqual(
				expect.arrayContaining([expect.objectContaining({ state: 'current' })])
			);
			expect(typeof processes[0]!.othersAreDoing).toBe('string');
			expect(body.record).toEqual(
				expect.arrayContaining([expect.objectContaining({ recordedBy: expect.any(String) })])
			);
			expect(JSON.stringify(body)).not.toContain('"document"');
		});
	});

	describe('permissions', () => {
		it('refuses an agent whose user lacks the role, and records nothing', async () => {
			const { caseId, attachmentId } = await newIncident('INC-9001 Permissions');
			const before = (await eventsOn(caseId)).length;

			const start = await call('rae', 'start_case', {
				casebook: 'acme',
				process: 'incident-management',
				title: 'INC-9002'
			});
			expect(start.error).toBe(true);
			expect(start.body).toMatchObject({ refused: 'access-denied' });

			const done = await call('rae', 'complete_task', {
				attachment_id: attachmentId,
				item: 'step.report-incident',
				values: { 'fact.incident-summary': 'Checkout is down', 'fact.affected-services': ['api'] }
			});
			expect(done.error).toBe(true);
			expect(done.body.refused).toBe('access-denied');
			expect(done.body.reason).toMatch(
				/acts for user "Rae Reader".*cannot act as role.on-call-engineer/
			);
			expect((await eventsOn(caseId)).length).toBe(before);
		});

		it('stops working the moment the user revokes the delegation', async () => {
			const { attachmentId } = await newIncident('INC-9003 Revoked');
			const agent = await agentFor(world.db, world.users.devon.id);
			const [grant] = await world.db
				.select({ id: schema.delegationGrants.id })
				.from(schema.delegationGrants)
				.where(eq(schema.delegationGrants.agentId, agent.id));
			await revokeDelegation(world.db, grant!.id);
			const done = await call(agent, 'complete_task', {
				attachment_id: attachmentId,
				item: 'step.report-incident',
				values: { 'fact.incident-summary': 'x', 'fact.affected-services': ['api'] }
			});
			expect(done.body).toMatchObject({ refused: 'access-denied' });
			expect(done.body.reason).toMatch(/no active delegation/);
		});
	});

	describe('attribution', () => {
		it('records the agent as actor and the user as who it acted for', async () => {
			const { caseId, attachmentId } = await newIncident('INC-9010 Attribution');
			const done = await call('devon', 'complete_task', {
				attachment_id: attachmentId,
				item: 'step.report-incident',
				values: { 'fact.incident-summary': 'Checkout is slow', 'fact.affected-services': ['api'] }
			});
			expect(done).toMatchObject({ error: false, body: { done: true } });

			const events = await world.db
				.select()
				.from(schema.caseEvents)
				.where(
					and(
						eq(schema.caseEvents.caseId, caseId),
						inArray(schema.caseEvents.type, ['case.opened', 'step.completed', 'fact.recorded'])
					)
				);
			expect(events.length).toBeGreaterThanOrEqual(4);
			for (const e of events) {
				expect(e).toMatchObject({
					actorId: agents.devon.id,
					actorKind: 'agent',
					onBehalfOfId: world.users.devon.id,
					onBehalfOfKind: 'user'
				});
			}
			const { body } = await call('devon', 'inspect_case', { casebook: 'acme', case_id: caseId });
			expect(
				(body.record as Record<string, unknown>[]).find((r) => r.fact === 'fact.incident-summary')
			).toMatchObject({
				value: 'Checkout is slow',
				recordedBy: 'Test agent',
				onBehalfOf: 'Devon Developer'
			});
		});
	});

	describe('approvals and human-only work', () => {
		it('are refused to agents, whatever role their user holds', async () => {
			const { attachmentId } = await newIncident('INC-9020 Sign-off');
			const ref = { attachmentId, item: '' };
			const human = (who: Subject, item: string, values: Record<string, string[]>, file = false) =>
				completeItem(
					world.db,
					world.users[who],
					{
						...ref,
						item,
						values,
						...(file
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
					{ files: world.files }
				);
			await human('devon', 'step.report-incident', {
				'fact.incident-summary': ['x'],
				'fact.affected-services': ['api']
			});
			await human('wren', 'decision.classify-severity', { 'fact.severity': ['SEV3'] });

			// Resolving is marked human-only.
			const resolve = await call('wren', 'complete_task', {
				attachment_id: attachmentId,
				item: 'step.resolve-incident',
				values: { 'fact.resolution-summary': 'Fixed', 'fact.resolved-at': '2026-10-25T10:00:00Z' }
			});
			expect(resolve.body).toMatchObject({ refused: 'human-only' });
			await human('wren', 'step.resolve-incident', {
				'fact.resolution-summary': ['Fixed'],
				'fact.resolved-at': ['2026-10-25T10:00:00Z']
			});
			const notify = await call('alex', 'complete_task', {
				attachment_id: attachmentId,
				item: 'step.notify-downstream',
				values: { 'fact.downstream-notified': true }
			});
			expect(notify).toMatchObject({ error: false, body: { done: true } });
			await human('wren', 'step.write-rca', {}, true);

			// Olive holds the director's role, but her agent still cannot sign off.
			const signOff = await call('olive', 'complete_task', {
				attachment_id: attachmentId,
				item: 'approval.rca-sign-off'
			});
			expect(signOff.body).toMatchObject({ refused: 'human-only' });
			expect(signOff.body.reason).toMatch(/Approvals are human-only/);
			const viaStore = await decideApproval(world.db, agents.olive, {
				attachmentId,
				item: 'approval.rca-sign-off',
				approve: true
			});
			expect(viaStore).toMatchObject({ ok: false, code: 'human-only' });

			const { body: task } = await call('olive', 'open_task', {
				casebook: 'acme',
				attachment_id: attachmentId,
				item: 'approval.rca-sign-off'
			});
			expect(task.task).toMatchObject({ status: 'ready', kind: 'approval' });
			expect(
				await decideApproval(world.db, world.users.olive, {
					attachmentId,
					item: 'approval.rca-sign-off',
					approve: true
				})
			).toMatchObject({ ok: true });
		});
	});

	describe('guests', () => {
		async function miraCase() {
			const { body } = await call('alex', 'list_my_work', { casebook: 'example-family' });
			return (body.cases as { id: string; title: string }[]).find(
				(c) => c.title === 'Mira Example'
			)!;
		}

		it('see only the forms sent to them, and only the values those use', async () => {
			const { body } = await call('dana', 'list_my_work');
			expect(body.casebooks).toEqual([]);
			const requests = body.requestsForYouAsAGuest as {
				attachmentId: string;
				item: string;
				title: string;
			}[];
			expect(requests.map((r) => r.title)).toEqual(['Send the itemised invoice']);

			expect(await call('dana', 'list_my_work', { casebook: 'example-family' })).toMatchObject({
				error: true,
				body: { refused: 'access-denied' }
			});
			const mira = await miraCase();
			expect(
				await call('dana', 'inspect_case', { casebook: 'example-family', case_id: mira.id })
			).toMatchObject({ error: true });

			const ref = { attachment_id: requests[0]!.attachmentId, item: requests[0]!.item };
			const { body: form } = await call('dana', 'open_task', ref);
			expect((form.fields as { title: string }[]).map((f) => f.title)).toEqual([
				'Itemised invoice',
				'Amount billed'
			]);
			const payload = JSON.stringify(form);
			for (const secret of ['BC-2026-004417', 'Riverside Hospital', 'Sam Example', mira.id]) {
				expect(payload).not.toContain(secret);
			}
			expect(await call('dana', 'open_task', { casebook: 'example-family', ...ref })).toMatchObject(
				{ error: true }
			);
		});

		it('are refused their human-only form, and read back only the files it uses', async () => {
			const { body } = await call('dana', 'list_my_work');
			const [request] = body.requestsForYouAsAGuest as { attachmentId: string; item: string }[];
			const invoice = {
				slot: 'fact:fact.itemised-invoice',
				name: 'invoice.pdf',
				contentType: 'application/pdf',
				bytes: new TextEncoder().encode('%PDF-1.4 invoice')
			};
			// Sending the invoice is marked human-only, so Dana's agent cannot.
			const byAgent = await call('dana', 'complete_task', {
				attachment_id: request!.attachmentId,
				item: request!.item,
				values: { 'fact.amount-billed': 1840 },
				files: [
					{
						slot: invoice.slot,
						name: invoice.name,
						content_type: invoice.contentType,
						content_base64: Buffer.from(invoice.bytes).toString('base64')
					}
				]
			});
			expect(byAgent).toMatchObject({ error: true, body: { refused: 'human-only' } });
			const byDana = await completeItem(
				world.db,
				world.users.dana,
				{ ...request!, values: { 'fact.amount-billed': ['1840'] }, files: [invoice] },
				{ files: world.files }
			);
			expect(byDana).toMatchObject({ ok: true });

			const mira = await miraCase();
			const { body: c } = await call('alex', 'inspect_case', {
				casebook: 'example-family',
				case_id: mira.id
			});
			const record = c.record as {
				fact?: string;
				file?: { id: string; name: string };
				recordedBy: string;
				onBehalfOf?: string;
			}[];
			const sent = record.find((r) => r.fact === 'fact.itemised-invoice')!;
			expect(sent).toMatchObject({ recordedBy: 'Dana Cole' });
			const read = await raw('dana', 'read_case_file', { file_id: sent.file!.id });
			expect(read.content[0]).toMatchObject({
				type: 'resource',
				resource: {
					mimeType: 'application/pdf',
					blob: Buffer.from('%PDF-1.4 invoice').toString('base64')
				}
			});
			const scan = record.find((r) => r.file?.name === 'birth-certificate-scan.pdf')!;
			const refused = await call('dana', 'read_case_file', { file_id: scan.file!.id });
			expect(refused).toMatchObject({ error: true, body: { refused: 'not-found' } });
		});
	});
});
