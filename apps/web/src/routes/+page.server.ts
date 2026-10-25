import type { PageServerLoad } from './$types';
import { loadWorkspaces } from '$lib/server/definitions';
import type { ViewId } from '$lib/graph/layout';

const VIEWS: ViewId[] = ['cards', 'lanes', 'facts'];

export const load: PageServerLoad = ({ url }) => {
	const workspaces = loadWorkspaces();
	const workspace =
		workspaces.find((w) => w.namespace === url.searchParams.get('ws')) ?? workspaces[0];
	const p = url.searchParams.get('p');
	const slug =
		p === 'map'
			? undefined
			: (workspace?.definitions.find((d) => d.document.slug === p) ?? workspace?.definitions[0])
					?.document.slug;
	const view = VIEWS.find((v) => v === url.searchParams.get('view')) ?? 'cards';
	return {
		workspaces,
		namespace: workspace?.namespace,
		slug,
		view,
		selected: url.searchParams.get('sel') ?? undefined
	};
};
