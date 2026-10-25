import { fail, redirect } from '@sveltejs/kit';
import {
	casebookPeople,
	listProcesses,
	loadCase,
	loadWork,
	rolesWithoutHolders,
	startCase
} from '@casebook/store';
import { getDb } from '$lib/server/db';
import { actorOf, orError, refused } from '$lib/server/runner';
import { links } from '$lib/runner/links';
import type { Actions, PageServerLoad } from './$types';

/**
 * Start a case: pick a published process the user may start (write access, or a role in it),
 * then a new case or an existing one, which shares that case's record (ADR 0001). Starting it
 * goes straight to its first task when that is the user's and ready, or else to the case.
 */
export const load: PageServerLoad = async ({ params, locals, url }) => {
	const actor = actorOf(locals);
	const [processes, work, people] = await Promise.all([
		listProcesses(getDb(), actor, params.instance),
		loadWork(getDb(), actor, params.instance),
		casebookPeople(getDb(), actor, params.instance)
	]);
	const startable = orError(processes)
		.groups.flatMap((g) => g.definitions)
		.filter((d) => d.status === 'published' && d.can.start.allowed);
	const cases = orError(work).cases;
	const fixed = url.searchParams.get('case');
	// Roles nobody holds yet are named on the case, like case-scoped ones, or its work waits on nobody.
	const unheld = await Promise.all(
		startable.map((d) =>
			rolesWithoutHolders(
				getDb(),
				d.id,
				d.document.nodes.filter((n) => n.core.kind === 'role').map((n) => n.core.id)
			)
		)
	);
	return {
		processes: startable.map((d, i) => ({
			id: d.id,
			slug: d.slug,
			title: d.title,
			document: d.document,
			unheld: unheld[i]!
		})),
		cases: cases.map((c) => ({
			id: c.id,
			title: c.title,
			processes: c.processes.map((p) => p.definitionId)
		})),
		people: orError(people),
		fixedCase: cases.find((c) => c.id === fixed)?.id ?? null,
		preselect: url.searchParams.get('process')
	};
};

export const actions: Actions = {
	default: async ({ request, locals, params }) => {
		const form = await request.formData();
		const definitionId = String(form.get('process') ?? '');
		if (!definitionId) return fail(400, { reason: 'Choose a process to run.' });
		const existing = form.get('target') === 'existing' ? String(form.get('existing') ?? '') : '';
		const roles: Record<string, string[]> = {};
		for (const [key, value] of form.entries()) {
			if (key.startsWith('role:') && typeof value === 'string')
				(roles[key.slice(5)] ??= []).push(value);
		}
		for (const role of form.getAll('roles')) roles[String(role)] ??= [];
		const result = await startCase(getDb(), actorOf(locals), {
			definitionId,
			...(existing ? { caseId: existing } : {}),
			title: String(form.get('title') ?? ''),
			subject: String(form.get('subject') ?? ''),
			label: String(form.get('label') ?? ''),
			roles
		});
		if (!result.ok) return refused(result);
		const started = `?started=${encodeURIComponent(String(form.get('processTitle') ?? 'the process'))}`;
		const opened = await loadCase(getDb(), actorOf(locals), params.instance, result.caseId);
		const first =
			'ok' in opened
				? undefined
				: opened.mine.find((t) => t.attachmentId === result.attachmentId && t.status === 'ready');
		redirect(
			303,
			first
				? `${links.task(params.instance, result.caseId, first.attachmentId, first.item)}${started}`
				: `${links.case(params.instance, result.caseId)}${started}`
		);
	}
};
