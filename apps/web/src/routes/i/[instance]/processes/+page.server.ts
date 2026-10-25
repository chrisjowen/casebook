import { listProcesses } from '@casebook/store';
import { getDb } from '$lib/server/db';
import { namespaceLabel } from '$lib/server/definitions';
import { actorOf, orError } from '$lib/server/runner';
import type { PageServerLoad } from './$types';

/** The process definitions in this instance, grouped by namespace, with what the user may do. */
export const load: PageServerLoad = async ({ params, locals }) => {
	const view = orError(await listProcesses(getDb(), actorOf(locals), params.instance));
	return {
		groups: view.groups.map((g) => ({ ...g, label: namespaceLabel(g.namespace) }))
	};
};
