/**
 * The form actions of a task page, shared by members and guests: complete it, save it to finish
 * later, start filling it in, pause it, resume it, skip it, approve or send back the work it
 * reviews, and ask someone for information in a thread on it. Each acts as the signed-in user
 * through the store's runtime, which checks their role with `can`.
 */
import { redirect, type Actions, type RequestEvent } from '@sveltejs/kit';
import {
	askQuestion,
	completeItem,
	decideApproval,
	demoPdf,
	holdItem,
	replyToQuestion,
	resolveQuestion,
	resumeItem,
	saveDraft,
	skipItem,
	startItem,
	type ItemRef,
	type RuntimeRefusal,
	type Upload
} from '@casebook/store';
import { getDb } from './db';
import { devSignInEnabled } from './session';
import { actorOf, fileStore, refused } from './runner';

/** Where a task page sends the user once the task is done, and which task it is. */
export interface TaskRoute {
	ref: (event: RequestEvent) => ItemRef;
	/** Where to go after completing or deciding it, given its title and whether it was sent back. */
	after: (event: RequestEvent, title: string, outcome: 'done' | 'sent-back') => string;
	/** Where Save for later leaves to, given the task's title. */
	saved: (event: RequestEvent, title: string) => string;
}

const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

/**
 * Reads a task form: `value:<fact>` fields (repeated for lists and people), and files in
 * `file:<slot>` fields, where a slot is `fact:<fact id>` or `evidence:<n>`. In development a
 * `demo:<slot>` field asks for a made-up PDF instead of an upload.
 */
export async function readForm(form: FormData) {
	const values: Record<string, string[]> = {};
	const files: Upload[] = [];
	for (const [key, entry] of form.entries()) {
		if (key.startsWith('value:') && typeof entry === 'string') {
			// Times are entered and shown in UTC.
			const value = LOCAL_DATE_TIME.test(entry) ? new Date(`${entry}Z`).toISOString() : entry;
			(values[key.slice(6)] ??= []).push(value);
		} else if (key.startsWith('file:') && entry instanceof File && entry.size > 0) {
			files.push({
				slot: key.slice(5),
				name: entry.name,
				contentType: entry.type,
				bytes: new Uint8Array(await entry.arrayBuffer())
			});
		} else if (key.startsWith('demo:') && entry === 'yes' && devSignInEnabled()) {
			const slot = key.slice(5);
			if (files.some((f) => f.slot === slot)) continue;
			const name = String(form.get(`demo-name:${slot}`) ?? 'demo document');
			files.push({
				slot,
				name: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`,
				contentType: 'application/pdf',
				bytes: demoPdf(name)
			});
		}
	}
	return { values, files };
}

const ok = <T extends { ok: boolean }>(result: T | RuntimeRefusal) =>
	result.ok ? undefined : refused(result as RuntimeRefusal);

export function taskActions(route: TaskRoute): Actions {
	return {
		complete: async (event) => {
			const form = await event.request.formData();
			const { values, files } = await readForm(form);
			const result = await completeItem(
				getDb(),
				actorOf(event.locals),
				{ ...route.ref(event), values, files },
				{ files: fileStore() }
			);
			if (!result.ok) return refused(result);
			redirect(303, route.after(event, String(form.get('title') ?? 'the task'), 'done'));
		},
		decide: async (event) => {
			const form = await event.request.formData();
			const verdict = form.get('verdict');
			if (verdict !== 'approve' && verdict !== 'send-back') {
				return refused({
					ok: false,
					code: 'invalid-input',
					reason: 'Choose whether to sign it off or send it back.',
					problems: [{ field: 'verdict', message: 'Choose one' }]
				});
			}
			const result = await decideApproval(getDb(), actorOf(event.locals), {
				...route.ref(event),
				approve: verdict === 'approve',
				note: String(form.get('note') ?? '')
			});
			if (!result.ok) return refused(result);
			redirect(
				303,
				route.after(
					event,
					String(form.get('title') ?? 'the review'),
					verdict === 'approve' ? 'done' : 'sent-back'
				)
			);
		},
		save: async (event) => {
			const form = await event.request.formData();
			const { values } = await readForm(form);
			const refusal = ok(
				await saveDraft(getDb(), actorOf(event.locals), { ...route.ref(event), values })
			);
			if (refusal) return refusal;
			// Save for later leaves the task; saving as people type stays.
			if (form.get('leave') === 'yes')
				redirect(303, route.saved(event, String(form.get('title') ?? 'the task')));
			return { saved: true };
		},
		reply: async (event) => {
			const form = await event.request.formData();
			return (
				ok(
					await replyToQuestion(getDb(), actorOf(event.locals), {
						...route.ref(event),
						question: Number(form.get('question')),
						text: String(form.get('text') ?? '')
					})
				) ?? { replied: true }
			);
		},
		resolve: async (event) => {
			const form = await event.request.formData();
			return (
				ok(
					await resolveQuestion(getDb(), actorOf(event.locals), {
						...route.ref(event),
						question: Number(form.get('question'))
					})
				) ?? { resolved: true }
			);
		},
		start: async (event) =>
			ok(await startItem(getDb(), actorOf(event.locals), route.ref(event))) ?? { started: true },
		hold: async (event) => {
			const form = await event.request.formData();
			const to = String(form.get('to') ?? '');
			if (to) {
				// Naming who can help asks them, in a thread on the task, pausing it unless told not to.
				const result = await askQuestion(getDb(), actorOf(event.locals), {
					...route.ref(event),
					to,
					text: String(form.get('note') ?? ''),
					pause: form.get('pause') === 'yes'
				});
				return result.ok ? { asked: true } : refused(result);
			}
			return (
				ok(
					await holdItem(getDb(), actorOf(event.locals), {
						...route.ref(event),
						note: String(form.get('note') ?? '')
					})
				) ?? { held: true }
			);
		},
		resume: async (event) =>
			ok(await resumeItem(getDb(), actorOf(event.locals), route.ref(event))) ?? { resumed: true },
		skip: async (event) => {
			const form = await event.request.formData();
			return (
				ok(
					await skipItem(getDb(), actorOf(event.locals), {
						...route.ref(event),
						reason: String(form.get('reason') ?? '')
					})
				) ?? { skipped: true }
			);
		}
	};
}
