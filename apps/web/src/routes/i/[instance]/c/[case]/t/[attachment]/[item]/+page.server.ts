import { loadTask } from '@casebook/store';
import { getDb } from '$lib/server/db';
import { actorOf, orError } from '$lib/server/runner';
import { devSignInEnabled } from '$lib/server/session';
import { taskActions } from '$lib/server/task-actions';
import { links } from '$lib/runner/links';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => ({
	task: orError(
		await loadTask(getDb(), actorOf(locals), params.instance, {
			attachmentId: params.attachment,
			item: params.item
		})
	),
	demoFiles: devSignInEnabled()
});

export const actions: Actions = taskActions({
	ref: ({ params }) => ({ attachmentId: params.attachment!, item: params.item! }),
	after: ({ params }, title) =>
		`${links.myWork(params.instance!)}?done=${encodeURIComponent(title)}`
});
