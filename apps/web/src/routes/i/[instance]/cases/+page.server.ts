import { loadWork } from '@casebook/store';
import { getDb } from '$lib/server/db';
import { actorOf, orError } from '$lib/server/runner';
import type { PageServerLoad } from './$types';

/** The cases the user can open in this instance, each a workspace of its own. */
export const load: PageServerLoad = async ({ params, locals }) => {
	const work = orError(await loadWork(getDb(), actorOf(locals), params.instance));
	return { cases: work.cases };
};
