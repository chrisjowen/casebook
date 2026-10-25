/** A process's home is one page with tabs: Overview, Edit (the board) and Cases. */
import type { Tab } from '$lib/runner/Frame.svelte';
import { links } from '$lib/runner/links';

export type ProcessTab = 'overview' | 'edit' | 'cases';

export function processTabs(
	instance: string,
	p: { slug: string; namespace: string; canEdit: boolean },
	active: ProcessTab,
	cases?: number
): Tab[] {
	return [
		{ label: 'Overview', href: links.process(instance, p.slug), active: active === 'overview' },
		{
			// Someone who cannot edit still opens the board, read-only.
			label: p.canEdit ? 'Edit' : 'Board',
			href: links.editor(instance, p.namespace, p.slug),
			active: active === 'edit'
		},
		{
			label: 'Cases',
			href: links.processCases(instance, p.slug),
			active: active === 'cases',
			...(cases ? { count: cases } : {})
		}
	];
}
