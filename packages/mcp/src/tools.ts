// The MCP tools (ADR 0023): what a signed-in user can do in the runner, for an agent acting as
// them. Each call runs through the store's runtime as the agent on behalf of its user, so `can`
// (ADR 0017) decides every read and write, and every event records the agent as actor and the
// user as who it acted for (ADR 0009). There is no approval tool: approvals are human-only, and
// the runtime refuses an agent that tries to complete one.
import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import { inArray } from 'drizzle-orm';
import { z } from 'zod';
import {
	completeItem,
	findCaseFile,
	holdItem,
	listInstances,
	listProcesses,
	loadCase,
	loadGuestTask,
	loadProcess,
	loadRequests,
	loadTask,
	loadWork,
	resumeItem,
	schema,
	skipItem,
	startCase,
	startItem,
	type Actor,
	type Db,
	type FileStore,
	type ReadRefusal,
	type RuntimeRefusal,
	type Upload
} from '@casebook/store';
import * as views from './views.js';

export interface CasebookServerOptions {
	db: Db;
	/** Where case files are kept: the same store the web app uses. */
	files: FileStore;
	/** Who every call acts as: an agent on behalf of its signed-in user. */
	actor: Actor;
}

/** The largest file `read_case_file` returns. */
const MAX_READ_BYTES = 10 * 1024 * 1024;

const INSTRUCTIONS = `casebook runs human-in-the-loop processes as cases. You are signed in as one person and act for them: you see and do only what they can, and everything you change is recorded as done by you on their behalf.
Start with list_my_work. A task is named by its attachmentId (one process on a case) and item id. Call open_task before complete_task to see the fields to fill in, then send values keyed by fact id.
Approvals are human-only: you cannot approve or send back work, so tell the person when an approval waits on them.`;

const casebook = z
	.string()
	.describe('The casebook (account) slug, such as "acme", from list_my_work.');
const taskRef = {
	attachment_id: z
		.string()
		.describe('The attachmentId of the process on the case, from list_my_work or inspect_case.'),
	item: z.string().describe('The work item id, such as "step.report-incident".')
};

/** A tool answer: JSON the agent reads. */
function answer(value: unknown): CallToolResult {
	return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

/** A refusal: nothing was done, with the store's reason and any problem with each field. */
function refused(
	result: Pick<RuntimeRefusal, 'code' | 'reason'> & { problems?: RuntimeRefusal['problems'] }
) {
	const problems = result.problems ?? [];
	return {
		isError: true,
		content: [
			{
				type: 'text' as const,
				text: JSON.stringify(
					{
						refused: result.code,
						reason: result.reason,
						...(problems.length
							? { problems: Object.fromEntries(problems.map((p) => [p.field, p.message])) }
							: {})
					},
					null,
					2
				)
			}
		]
	};
}

const isRefusal = (value: object): value is ReadRefusal | RuntimeRefusal =>
	'ok' in value && value.ok === false;

/** Builds the MCP server for one signed-in agent. */
export function casebookServer({ db, files, actor }: CasebookServerOptions): McpServer {
	const server = new McpServer(
		{ name: 'casebook', title: 'casebook', version: '0.0.0' },
		{ instructions: INSTRUCTIONS }
	);
	const read = { readOnlyHint: true, openWorldHint: false } as const;
	const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

	server.registerTool(
		'list_my_work',
		{
			title: 'List my work',
			description:
				'Without a casebook: who you are signed in as, the casebooks they belong to with how much waits on them, and any forms sent to them as a guest. With a casebook: what is ready for them, what they paused for missing information, what they wait on others for, repeating work, and the cases they can open.',
			inputSchema: z.object({ casebook: casebook.optional() }),
			annotations: read
		},
		async ({ casebook: slug }) => {
			if (slug === undefined) {
				return answer({
					signedIn: await signedIn(db, actor),
					casebooks: views.casebooks(await listInstances(db, actor)),
					requestsForYouAsAGuest: views.guestRequests(await loadRequests(db, actor))
				});
			}
			const view = await loadWork(db, actor, slug);
			return isRefusal(view) ? refused(view) : answer(views.work(view));
		}
	);

	server.registerTool(
		'list_processes',
		{
			title: 'List processes',
			description:
				'The processes in a casebook the user can read: status, version, change policy, live cases, and whether they may start a case of each.',
			inputSchema: z.object({ casebook }),
			annotations: read
		},
		async ({ casebook: slug }) => {
			const view = await listProcesses(db, actor, slug);
			if (isRefusal(view)) return refused(view);
			return answer(
				view.groups.flatMap((g) =>
					g.definitions.map((d) => ({
						id: d.id,
						slug: d.slug,
						title: d.title,
						namespace: d.namespace,
						status: d.status,
						version: d.version,
						changePolicy: d.policy,
						liveCases: d.liveCases,
						youCanStartACase: d.can.start.allowed,
						...(d.can.start.allowed ? {} : { whyNot: d.can.start.reason })
					}))
				)
			);
		}
	);

	server.registerTool(
		'read_process',
		{
			title: 'Read a process',
			description:
				'One process, read-only: its stages and the steps, decisions and approvals in each, with the role that does each one, what it needs and records, its conditions, and the cases running it that the user can open.',
			inputSchema: z.object({
				casebook,
				process: z.string().describe('The process slug or id, from list_processes.')
			}),
			annotations: read
		},
		async ({ casebook: slug, process }) => {
			const view = await loadProcess(db, actor, slug, process);
			return isRefusal(view) ? refused(view) : answer(views.processView(view));
		}
	);

	server.registerTool(
		'inspect_case',
		{
			title: 'Inspect a case',
			description:
				'A case the user can open: their tasks on it, one stage strip per process with what others are doing and every item’s status, and the case record of values and files with who recorded each and where it came from.',
			inputSchema: z.object({ casebook, case_id: z.string().describe('The case id.') }),
			annotations: read
		},
		async ({ casebook: slug, case_id }) => {
			const view = await loadCase(db, actor, slug, case_id);
			return isRefusal(view) ? refused(view) : answer(views.caseView(view));
		}
	);

	server.registerTool(
		'open_task',
		{
			title: 'Open a task',
			description:
				'One task’s form: who it is for and whether the user can do it, the values it uses, and the fields to fill in, typed from each fact. Give the casebook for a task on a case the user belongs to; leave it out for a form sent to them as a guest.',
			inputSchema: z.object({ casebook: casebook.optional(), ...taskRef }),
			annotations: read
		},
		async ({ casebook: slug, attachment_id, item }) => {
			const ref = { attachmentId: attachment_id, item };
			const view =
				slug === undefined
					? await loadGuestTask(db, actor, ref)
					: await loadTask(db, actor, slug, ref);
			return isRefusal(view) ? refused(view) : answer(views.taskView(view));
		}
	);

	server.registerTool(
		'start_case',
		{
			title: 'Start a case',
			description:
				'Starts a published process: on a new case with a title, or on an existing case given its id. Needs write on the process’s namespace or one of its roles. The user takes the role of its first task.',
			inputSchema: z.object({
				casebook,
				process: z.string().describe('The process slug or id, from list_processes.'),
				title: z.string().optional().describe('The new case’s name; needed without case_id.'),
				subject: z.string().optional().describe('What or whom the new case is about.'),
				case_id: z.string().optional().describe('Attach the process to this existing case.'),
				label: z
					.string()
					.optional()
					.describe('Tells two runs of one process on a case apart, such as "Delivery bill".')
			}),
			annotations: write
		},
		async ({ casebook: slug, process, title, subject, case_id, label }) => {
			const list = await listProcesses(db, actor, slug);
			if (isRefusal(list)) return refused(list);
			const found = list.groups
				.flatMap((g) => g.definitions)
				.find((d) => d.slug === process || d.id === process);
			if (!found) {
				return refused({
					code: 'not-found',
					reason: 'There is no such process here, or you cannot read it.'
				});
			}
			const started = await startCase(db, actor, {
				definitionId: found.id,
				...(case_id !== undefined ? { caseId: case_id } : {}),
				...(title !== undefined ? { title } : {}),
				...(subject !== undefined ? { subject } : {}),
				...(label !== undefined ? { label } : {})
			});
			if (!started.ok) return refused(started);
			return answer({
				started: true,
				caseId: started.caseId,
				attachmentId: started.attachmentId,
				next: 'Call inspect_case to see the new case and your first task.'
			});
		}
	);

	server.registerTool(
		'complete_task',
		{
			title: 'Complete a task',
			description:
				'Completes a step or records a decision, with the values and files it records. Values are keyed by fact id, as text the way a form takes them: numbers as digits, yes or no, dates as 2026-01-15, times in ISO 8601 UTC, people by id, and lists as several values. A file is attached to slot "fact:<fact id>" or "evidence:<n>", from open_task. Facts already on the case are kept unless given again. Steps marked human-only and approvals are refused to agents.',
			inputSchema: z.object({
				...taskRef,
				values: z
					.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]))
					.optional()
					.describe('What to record, by fact id.'),
				files: z
					.array(
						z.object({
							slot: z.string().describe('"fact:<fact id>" or "evidence:<n>".'),
							name: z.string().describe('The file name, such as "invoice.pdf".'),
							content_type: z.string().describe('Its media type, such as "application/pdf".'),
							content_base64: z.string().describe('The file’s bytes, base64-encoded.')
						})
					)
					.optional()
			}),
			annotations: write
		},
		async ({ attachment_id, item, values, files: uploads }) => {
			const decoded: Upload[] = [];
			for (const f of uploads ?? []) {
				const bytes = base64(f.content_base64);
				if (!bytes) {
					return refused({
						code: 'invalid-input',
						reason: `${f.name} is not base64.`,
						problems: [{ field: f.slot, message: `${f.name} is not base64` }]
					});
				}
				decoded.push({ slot: f.slot, name: f.name, contentType: f.content_type, bytes });
			}
			const result = await completeItem(
				db,
				actor,
				{
					attachmentId: attachment_id,
					item,
					values: Object.fromEntries(
						Object.entries(values ?? {}).map(([fact, v]) => [fact, asText(v)])
					),
					files: decoded
				},
				{ files }
			);
			if (!result.ok) return refused(result);
			return answer({ done: true, recorded: result.recorded });
		}
	);

	server.registerTool(
		'start_task',
		{
			title: 'Start a task',
			description:
				'Notes that the user has started a task, so others see who is on it. There is no claim: whoever completes it first finishes it.',
			inputSchema: z.object(taskRef),
			annotations: { ...write, idempotentHint: true }
		},
		async ({ attachment_id, item }) => {
			const result = await startItem(db, actor, { attachmentId: attachment_id, item });
			return result.ok ? answer({ started: true }) : refused(result);
		}
	);

	server.registerTool(
		'pause_task',
		{
			title: 'Pause a task',
			description:
				'“I can’t finish this yet”: pauses a task because information is missing. The note says what, and whoever waits on the task sees it.',
			inputSchema: z.object({ ...taskRef, note: z.string().describe('What is missing.') }),
			annotations: write
		},
		async ({ attachment_id, item, note }) => {
			const result = await holdItem(db, actor, { attachmentId: attachment_id, item, note });
			return result.ok ? answer({ paused: true }) : refused(result);
		}
	);

	server.registerTool(
		'resume_task',
		{
			title: 'Resume a task',
			description: 'Takes a paused task off hold.',
			inputSchema: z.object(taskRef),
			annotations: { ...write, idempotentHint: true }
		},
		async ({ attachment_id, item }) => {
			const result = await resumeItem(db, actor, { attachmentId: attachment_id, item });
			return result.ok ? answer({ resumed: true }) : refused(result);
		}
	);

	server.registerTool(
		'skip_task',
		{
			title: 'Skip a task',
			description:
				'Records that a task does not apply on this case, saying why. Only a task whose condition is prose, which its role decides, can be skipped; open_task says whether it can.',
			inputSchema: z.object({ ...taskRef, reason: z.string().describe('Why it does not apply.') }),
			annotations: write
		},
		async ({ attachment_id, item, reason }) => {
			const result = await skipItem(db, actor, { attachmentId: attachment_id, item, reason });
			return result.ok ? answer({ skipped: true }) : refused(result);
		}
	);

	server.registerTool(
		'read_case_file',
		{
			title: 'Read a case file',
			description:
				'The contents of a file on a case, by the file id from the case record or a task’s values. Text comes back as text, anything else as base64.',
			inputSchema: z.object({ file_id: z.string().describe('The file id.') }),
			annotations: read
		},
		async ({ file_id }) => {
			const found = await findCaseFile(db, actor, file_id);
			if ('ok' in found) return refused(found);
			const bytes = await files.get(found.storageKey);
			if (!bytes) return refused({ code: 'not-found', reason: 'The file’s contents are missing.' });
			if (bytes.byteLength > MAX_READ_BYTES) {
				return refused({ code: 'invalid-input', reason: `${found.name} is larger than 10 MB.` });
			}
			const uri = `casebook:file/${file_id}`;
			const text = /^text\/|[+/]json$|[+/]xml$/.test(found.contentType);
			return {
				content: [
					{
						type: 'resource',
						resource: text
							? { uri, mimeType: found.contentType, text: new TextDecoder().decode(bytes) }
							: { uri, mimeType: found.contentType, blob: Buffer.from(bytes).toString('base64') }
					}
				]
			};
		}
	);

	return server;
}

/** Who the agent is and whom it acts for, by name. */
async function signedIn(db: Db, actor: Actor) {
	const ids = [actor.id, ...(actor.onBehalfOfId ? [actor.onBehalfOfId] : [])];
	const rows = await db
		.select({ id: schema.principals.id, name: schema.principals.displayName })
		.from(schema.principals)
		.where(inArray(schema.principals.id, ids));
	const name = (id: string | undefined) => rows.find((r) => r.id === id)?.name;
	return {
		as: name(actor.onBehalfOfId ?? actor.id),
		userId: actor.onBehalfOfId ?? actor.id,
		agent: actor.onBehalfOfId ? name(actor.id) : undefined
	};
}

/** A value as the text a form field would send. */
function asText(value: string | number | boolean | string[]): string[] {
	if (Array.isArray(value)) return value;
	if (typeof value === 'boolean') return [value ? 'yes' : 'no'];
	return [String(value)];
}

function base64(text: string): Uint8Array | undefined {
	const clean = text.replace(/\s/g, '');
	if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(clean)) return undefined;
	return new Uint8Array(
		Buffer.from(clean, clean.includes('-') || clean.includes('_') ? 'base64url' : 'base64')
	);
}
