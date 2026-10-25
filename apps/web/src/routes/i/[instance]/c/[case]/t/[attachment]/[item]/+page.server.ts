import { loadTask, loadWork, type TaskSummary } from '@casebook/store';
import { getDb } from '$lib/server/db';
import { actorOf, orError } from '$lib/server/runner';
import { devSignInEnabled } from '$lib/server/session';
import { taskActions } from '$lib/server/task-actions';
import { links } from '$lib/runner/links';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, url }) => {
	const actor = actorOf(locals);
	const task = orError(
		await loadTask(getDb(), actor, params.instance, {
			attachmentId: params.attachment,
			item: params.item
		})
	);
	// Just finished: hand over to what comes next, on this case first, then anywhere.
	let next: TaskSummary[] | undefined;
	if (url.searchParams.has('done')) {
		const work = orError(await loadWork(getDb(), actor, params.instance));
		const others = work.ready.filter(
			(t) => !(t.attachmentId === params.attachment && t.item === params.item)
		);
		next = [
			...others.filter((t) => t.caseId === params.case),
			...others.filter((t) => t.caseId !== params.case)
		].slice(0, 3);
	}
	return { task, next, demoFiles: devSignInEnabled() };
};

export const actions: Actions = taskActions({
	ref: ({ params }) => ({ attachmentId: params.attachment!, item: params.item! }),
	after: ({ params }) =>
		`${links.task(params.instance!, params.case!, params.attachment!, params.item!)}?done=1`
});
