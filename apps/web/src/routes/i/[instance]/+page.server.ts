import { loadWork } from '@casebook/store';
import { getDb } from '$lib/server/db';
import { actorOf, orError } from '$lib/server/runner';
import type { PageServerLoad } from './$types';

/** My work in one instance, with the cases the user can open. */
export const load: PageServerLoad = async ({ params, locals }) => ({
	work: orError(await loadWork(getDb(), actorOf(locals), params.instance))
});
