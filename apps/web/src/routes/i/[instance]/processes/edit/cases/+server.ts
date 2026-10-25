// The cases running a process, with their facts, for testing the process's conditions in the
// editor against real values. Only cases the signed-in user can read are included.
import { json } from '@sveltejs/kit';
import { loadCaseFacts } from '@casebook/store';
import { getDb } from '$lib/server/db';
import { actorOf, orError } from '$lib/server/runner';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, params, locals }) => {
	const found = orError(
		await loadCaseFacts(getDb(), actorOf(locals), params.instance, url.searchParams.get('p') ?? '')
	);
	return json(found.cases);
};
