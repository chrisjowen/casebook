import { loadProcess, moveToLatest } from '@casebook/store';
import { getDb } from '$lib/server/db';
import { namespaceLabel } from '$lib/server/definitions';
import { actorOf, orError, refused } from '$lib/server/runner';
import type { Actions, PageServerLoad } from './$types';

/** One process: status and policy, Edit and Start a case, the cases running it, its outline. */
export const load: PageServerLoad = async ({ params, locals }) => {
	const view = orError(await loadProcess(getDb(), actorOf(locals), params.instance, params.slug));
	return { view, namespaceLabel: namespaceLabel(view.process.namespace) };
};

export const actions: Actions = {
	/** Moves a pinned case to the latest version: explicit and recorded (ADR 0016). */
	move: async ({ request, locals }) => {
		const form = await request.formData();
		const result = await moveToLatest(
			getDb(),
			actorOf(locals),
			String(form.get('attachment') ?? '')
		);
		if (!result.ok) return refused(result);
		return { moved: String(form.get('title') ?? 'The case'), version: result.version };
	}
};
