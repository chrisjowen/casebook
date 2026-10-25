import { loadCase } from '@casebook/store';
import { getDb } from '$lib/server/db';
import { actorOf, orError } from '$lib/server/runner';
import type { LayoutServerLoad } from './$types';

/** A case the user can open: their tasks on it, its processes and its record. */
export const load: LayoutServerLoad = async ({ params, locals }) => ({
	case: orError(await loadCase(getDb(), actorOf(locals), params.instance, params.case))
});
