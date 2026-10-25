import { error, redirect } from '@sveltejs/kit';
import { listInstances } from '@casebook/store';
import { getDb } from '$lib/server/db';
import { actorOf } from '$lib/server/runner';
import { loadShell } from '$lib/server/shell';
import { links } from '$lib/runner/links';
import type { LayoutServerLoad } from './$types';

/**
 * An instance is an account the user is a member of (ADR 0015). Everything below it is scoped
 * to that account; guests, who belong to none, have only their requests. The app shell's sidebar
 * and palette come with it.
 */
export const load: LayoutServerLoad = async ({ params, locals, depends }) => {
	const actor = actorOf(locals);
	const instances = await listInstances(getDb(), actor);
	const instance = instances.find((i) => i.slug === params.instance);
	if (!instance) {
		if (instances.length === 0) redirect(303, links.requests());
		error(403, 'You are not a member of this casebook.');
	}
	depends('casebook:shell');
	return { user: locals.user!, instance, instances, shell: await loadShell(actor, instance.slug) };
};
