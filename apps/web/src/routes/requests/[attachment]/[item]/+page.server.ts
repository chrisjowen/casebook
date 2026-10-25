import { loadGuestTask } from '@casebook/store';
import { getDb } from '$lib/server/db';
import { actorOf, guestOf, orError } from '$lib/server/runner';
import { devSignInEnabled } from '$lib/server/session';
import { taskActions } from '$lib/server/task-actions';
import { links } from '$lib/runner/links';
import type { Actions, PageServerLoad } from './$types';

/** A guest's form: only the values it needs, one line of context and who asked. */
export const load: PageServerLoad = async ({ params, locals }) => ({
	user: guestOf(locals),
	task: orError(
		await loadGuestTask(getDb(), actorOf(locals), {
			attachmentId: params.attachment,
			item: params.item
		})
	),
	demoFiles: devSignInEnabled()
});

export const actions: Actions = taskActions({
	ref: ({ params }) => ({ attachmentId: params.attachment!, item: params.item! }),
	after: (_, title) => `${links.requests()}?done=${encodeURIComponent(title)}`
});
