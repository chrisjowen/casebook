// What the editor needs to test a process's conditions against real values: the cases running
// it, with their facts, and the people of the instance, so people facts read as names. Only cases
// the signed-in user can read are included.
import { json } from '@sveltejs/kit';
import { casebookPeople, loadCaseFacts } from '@casebook/store';
import { getDb } from '$lib/server/db';
import { actorOf, orError } from '$lib/server/runner';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, params, locals }) => {
	const actor = actorOf(locals);
	const found = orError(
		await loadCaseFacts(getDb(), actor, params.instance, url.searchParams.get('p') ?? '')
	);
	const people = orError(await casebookPeople(getDb(), actor, params.instance));
	return json({ cases: found.cases, people });
};
