import { loadRequests } from '@casebook/store';
import { getDb } from '$lib/server/db';
import { actorOf } from '$lib/server/runner';
import type { PageServerLoad } from './$types';

/** A guest's inbox: the forms addressed to them, across every casebook that asked. */
export const load: PageServerLoad = async ({ locals }) => {
	const requests = await loadRequests(getDb(), actorOf(locals));
	const groups = [...new Set(requests.map((r) => r.from))].map((from) => ({
		from,
		requests: requests.filter((r) => r.from === from)
	}));
	return { user: locals.user!, groups };
};
