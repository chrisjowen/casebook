// What the command palette searches beyond the processes the shell already has: the cases the
// user can open in this instance and the tasks ready for them or paused by them.
import { json } from '@sveltejs/kit';
import { loadWork } from '@casebook/store';
import { getDb } from '$lib/server/db';
import { actorOf, orError } from '$lib/server/runner';
import type { SearchData } from '$lib/shell/types';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
	const work = orError(await loadWork(getDb(), actorOf(locals), params.instance));
	const body: SearchData = {
		cases: work.cases.map((c) => ({
			id: c.id,
			title: c.title,
			forYou: c.forYou,
			...(c.subject ? { subject: c.subject } : {})
		})),
		tasks: [...work.ready, ...work.held].map((t) => ({
			caseId: t.caseId,
			caseTitle: t.caseTitle,
			attachmentId: t.attachmentId,
			item: t.item,
			title: t.title,
			process: t.process,
			definitionSlug: t.definitionSlug
		}))
	};
	return json(body);
};
