import { error, redirect } from '@sveltejs/kit';
import { listInstances } from '@casebook/store';
import { getDb } from '$lib/server/db';
import { actorOf } from '$lib/server/runner';
import { links } from '$lib/runner/links';
import type { LayoutServerLoad } from './$types';

/**
 * An instance is an account the user is a member of (ADR 0015). Everything below it is scoped
 * to that account; guests, who belong to none, have only their requests.
 */
export const load: LayoutServerLoad = async ({ params, locals }) => {
	const instances = await listInstances(getDb(), actorOf(locals));
	const instance = instances.find((i) => i.slug === params.instance);
	if (!instance) {
		if (instances.length === 0) redirect(303, links.requests());
		error(403, 'You are not a member of this casebook.');
	}
	return { user: locals.user!, instance, instances };
};
