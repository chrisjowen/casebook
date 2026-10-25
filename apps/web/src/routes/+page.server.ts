import { redirect } from '@sveltejs/kit';
import { listDefinitions, listInstances } from '@casebook/store';
import { getDb } from '$lib/server/db';
import { actorOf } from '$lib/server/runner';
import { links } from '$lib/runner/links';
import type { PageServerLoad } from './$types';

/**
 * Home: My work in the casebook that most needs the user, or a guest's requests. Old editor links
 * (`/?ws=…&p=…`) open the editor in the instance that owns the namespace.
 */
export const load: PageServerLoad = async ({ url, locals }) => {
	const actor = actorOf(locals);
	const ws = url.searchParams.get('ws');
	if (ws) {
		const owner = (await listDefinitions(getDb(), actor)).find((n) => n.namespace.path === ws);
		if (owner) {
			redirect(303, `${links.editor(owner.namespace.accountSlug)}?${url.searchParams}`);
		}
	}
	const instances = await listInstances(getDb(), actor);
	const first = instances.find((i) => i.waitingOnYou > 0) ?? instances[0];
	redirect(303, first ? links.myWork(first.slug) : links.requests());
};
