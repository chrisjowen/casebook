import { fail, redirect } from '@sveltejs/kit';
import {
	createSharedLookup,
	deleteSharedLookup,
	editSharedLookup,
	listSharedLookups,
	readSharedLookup,
	sharedLookupHistory,
	sharedLookupUses,
	undoSharedLookupEdit,
	type Refusal
} from '@casebook/store';
import { getDb } from '$lib/server/db';
import { loadWorkspaces, namespaceLabel } from '$lib/server/definitions';
import { factsUsingLookup } from '@casebook/model';
import { actorOf } from '$lib/server/runner';
import { links } from '$lib/runner/links';
import type { Actions, PageServerLoad } from './$types';

/**
 * Shared lookups (ADR 0025): every workspace the user can read in this instance with its lookups,
 * and the open one with the processes that choose from it and its versions.
 */
export const load: PageServerLoad = async ({ params, locals, url }) => {
	const actor = actorOf(locals);
	const groups = (await listSharedLookups(getDb(), actor, params.instance)).map((g) => ({
		id: g.namespace.id,
		namespace: g.namespace.path,
		label: namespaceLabel(g.namespace.path),
		canEdit: g.can.edit,
		lookups: g.lookups.map((l) => ({
			id: l.id,
			title: l.title,
			count: l.values.length,
			off: l.values.filter((v) => v.disabled).length
		}))
	}));
	// Lookups kept inside a process, which open in the editor.
	const inProcesses = (await loadWorkspaces(actor, params.instance)).flatMap((w) =>
		w.definitions.flatMap((d) => {
			const process = d.document.nodes.find((n) => n.core.kind === 'process');
			return d.document.nodes.flatMap((n) =>
				n.core.kind === 'lookup'
					? [
							{
								id: n.core.id,
								title: n.core.title ?? n.core.id,
								count: n.core.values.length,
								uses: factsUsingLookup(d.document, n.core.id).length,
								process: process?.core.title ?? d.document.slug,
								slug: d.document.slug,
								namespace: w.namespace
							}
						]
					: []
			);
		})
	);
	const wanted = url.searchParams.get('l') ?? groups.flatMap((g) => g.lookups)[0]?.id;
	const read = wanted ? await readSharedLookup(getDb(), actor, wanted) : undefined;
	if (!read?.ok) return { groups, inProcesses, open: undefined };
	const { lookup, can } = read;
	return {
		groups,
		inProcesses,
		open: {
			id: lookup.id,
			name: lookup.name,
			title: lookup.title,
			content: lookup.content,
			values: lookup.values,
			version: lookup.version,
			namespace: lookup.namespace.path,
			namespaceLabel: namespaceLabel(lookup.namespace.path),
			updatedAt: lookup.updatedAt.toISOString(),
			updatedBy: lookup.updatedByName,
			canEdit: can.edit,
			uses: await sharedLookupUses(getDb(), lookup),
			history: (await sharedLookupHistory(getDb(), lookup.id)).map((v) => ({
				...v,
				at: v.at.toISOString()
			}))
		}
	};
};

const STATUS: Partial<Record<Refusal['code'], number>> = {
	'access-denied': 403,
	'not-found': 404,
	'stale-draft': 409
};

const refused = (r: Refusal) => fail(STATUS[r.code] ?? 422, { code: r.code, reason: r.reason });

export const actions: Actions = {
	/** Makes a shared lookup from a process's own, for the editor to point its facts at. */
	share: async ({ request, locals }) => {
		const form = await request.formData();
		let values: unknown;
		try {
			values = JSON.parse(String(form.get('values') ?? '[]'));
		} catch {
			return fail(400, { code: 'invalid-operation', reason: 'The values were not valid JSON' });
		}
		const result = await createSharedLookup(getDb(), actorOf(locals), {
			namespaceId: String(form.get('namespaceId') ?? ''),
			title: String(form.get('title') ?? ''),
			values: values as Parameters<typeof createSharedLookup>[2]['values']
		});
		return result.ok ? result : refused(result);
	},
	create: async ({ request, locals, params }) => {
		const form = await request.formData();
		const result = await createSharedLookup(getDb(), actorOf(locals), {
			namespaceId: String(form.get('namespaceId') ?? ''),
			title: String(form.get('title') ?? '')
		});
		if (!result.ok) return refused(result);
		redirect(303, links.lookups(params.instance, result.id));
	},
	edit: async ({ request, locals }) => {
		const form = await request.formData();
		let changes: unknown;
		try {
			changes = JSON.parse(String(form.get('changes')));
		} catch {
			return fail(400, { code: 'invalid-operation', reason: 'The change was not valid JSON' });
		}
		if (typeof changes !== 'object' || changes === null || Array.isArray(changes)) {
			return fail(400, {
				code: 'invalid-operation',
				reason: 'The change did not say what to change'
			});
		}
		const result = await editSharedLookup(getDb(), actorOf(locals), {
			lookupId: String(form.get('lookupId')),
			baseVersion: Number(form.get('baseVersion')),
			changes: changes as Parameters<typeof editSharedLookup>[2]['changes']
		});
		return result.ok ? result : refused(result);
	},
	undo: async ({ request, locals }) => {
		const form = await request.formData();
		const result = await undoSharedLookupEdit(getDb(), actorOf(locals), {
			lookupId: String(form.get('lookupId')),
			baseVersion: Number(form.get('baseVersion'))
		});
		return result.ok ? result : refused(result);
	},
	delete: async ({ request, locals, params }) => {
		const form = await request.formData();
		const result = await deleteSharedLookup(getDb(), actorOf(locals), String(form.get('lookupId')));
		if (!result.ok) return refused(result);
		redirect(303, links.lookups(params.instance));
	}
};
