import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	createDefinition,
	editDefinition,
	publishDefinition,
	undoDefinitionEdit,
	type Refusal
} from '@casebook/store';
import { getDb } from '$lib/server/db';
import { loadWorkspaces } from '$lib/server/definitions';
import { actorOf } from '$lib/server/runner';
import { loadWizard } from '$lib/server/wizard';
import type { ViewId } from '$lib/graph/layout';

const VIEWS: ViewId[] = ['board', 'lanes', 'facts'];

export const load: PageServerLoad = async ({ url, locals, params }) => {
	const workspaces = await loadWorkspaces(actorOf(locals), params.instance);
	const workspace =
		workspaces.find((w) => w.namespace === url.searchParams.get('ws')) ??
		workspaces.find((w) => w.definitions.length > 0) ??
		workspaces[0];
	const p = url.searchParams.get('p');
	const slug =
		p === 'map'
			? undefined
			: (workspace?.definitions.find((d) => d.document.slug === p) ?? workspace?.definitions[0])
					?.document.slug;
	// "cards" was the board's name before it could be built on; old links still open it
	const view = VIEWS.find((v) => v === url.searchParams.get('view')) ?? 'board';
	const actor = actorOf(locals);
	const wizardId = url.searchParams.get('wizard');
	const wizard = wizardId ? await loadWizard(actor, wizardId, slug) : undefined;
	return {
		user: locals.user!,
		workspaces,
		namespace: workspace?.namespace,
		slug,
		view,
		selected: url.searchParams.get('sel') ?? undefined,
		// A spreadsheet import in progress, shown with its assistant; the shell lists the others.
		wizard: wizard && wizard.namespaceId === workspace?.id ? wizard : undefined
	};
};

/**
 * Editing actions. Each acts as the signed-in user, and the store checks their permission with
 * `can` before writing; a refusal comes back as a failure carrying its plain-language reason.
 */
export const actions: Actions = {
	edit: async ({ request, locals }) => {
		const form = await request.formData();
		let ops: unknown;
		try {
			ops = JSON.parse(String(form.get('ops')));
		} catch {
			return fail(400, { code: 'invalid-operation', reason: 'The edit was not valid JSON' });
		}
		return outcome(
			await editDefinition(getDb(), actorOf(locals), {
				definitionId: String(form.get('definitionId')),
				ops: Array.isArray(ops) ? ops : [ops],
				baseRevision: Number(form.get('baseRevision'))
			})
		);
	},
	undo: async ({ request, locals }) => {
		const form = await request.formData();
		return outcome(
			await undoDefinitionEdit(getDb(), actorOf(locals), {
				definitionId: String(form.get('definitionId')),
				baseRevision: Number(form.get('baseRevision'))
			})
		);
	},
	publish: async ({ request, locals }) => {
		const form = await request.formData();
		return outcome(
			await publishDefinition(getDb(), actorOf(locals), {
				definitionId: String(form.get('definitionId')),
				baseRevision: Number(form.get('baseRevision'))
			})
		);
	},
	create: async ({ request, locals }) => {
		const form = await request.formData();
		return outcome(
			await createDefinition(getDb(), actorOf(locals), {
				namespaceId: String(form.get('namespaceId')),
				title: String(form.get('title') ?? ''),
				changePolicy: form.get('changePolicy') === 'living' ? 'living' : 'governed'
			})
		);
	}
};

const STATUS: Partial<Record<Refusal['code'], number>> = {
	'access-denied': 403,
	'not-found': 404,
	'stale-draft': 409
};

function outcome<T extends { ok: true }>(result: T | Refusal) {
	if (result.ok) return result;
	return fail(STATUS[result.code] ?? 422, {
		code: result.code,
		reason: result.reason,
		problems: [...result.errors, ...result.issues.filter((i) => i.severity === 'error')].map(
			(p) => p.message
		)
	});
}
