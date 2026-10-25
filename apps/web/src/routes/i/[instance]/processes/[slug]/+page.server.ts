import { loadProcess } from '@casebook/store';
import { getDb } from '$lib/server/db';
import { namespaceLabel } from '$lib/server/definitions';
import { actorOf, orError } from '$lib/server/runner';
import type { PageServerLoad } from './$types';

/** A process's Overview tab: status and policy, its stages and steps, and the cases running it. */
export const load: PageServerLoad = async ({ params, locals }) => {
	const view = orError(await loadProcess(getDb(), actorOf(locals), params.instance, params.slug));
	return { view, namespaceLabel: namespaceLabel(view.process.namespace) };
};
