import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';
import { load } from './+page.server';
import { loadWorkspaces } from '$lib/server/definitions';
import { indexDocument, labelOf } from '$lib/graph/derive';

type LoadEvent = Parameters<typeof load>[0];
type PageData = Exclude<Awaited<ReturnType<typeof load>>, void>;

const pageFor = (query: string) => {
	const data = load({ url: new URL(`http://localhost/?${query}`) } as LoadEvent) as PageData;
	return render(Page, { props: { data, params: {} } as never }).body;
};

describe('editor route', () => {
	const definitions = loadWorkspaces().flatMap((w) =>
		w.definitions.map((d) => ({ namespace: w.namespace, document: d.document }))
	);

	it('loads every fixture, and every fixture passes its publish checks', () => {
		expect(definitions.map((d) => d.document.slug).sort()).toEqual([
			'birth-registration-abroad',
			'incident-management'
		]);
		for (const w of loadWorkspaces()) for (const d of w.definitions) expect(d.ok).toBe(true);
	});

	it.each(definitions)(
		'renders $document.slug with its process and every step',
		({ namespace, document }) => {
			const html = pageFor(new URLSearchParams({ ws: namespace, p: document.slug }).toString());
			const ix = indexDocument(document);
			expect(html).toContain(labelOf(ix, ix.process?.core.id));
			for (const item of ix.work) expect(html).toContain(labelOf(ix, item.core.id));
			expect(html).toContain('Viewing definitions');
		}
	);

	it('opens the definition inspector for a selected step, not a form', () => {
		const html = pageFor('ws=acme/eng/sre&p=incident-management&sel=step.write-rca');
		expect(html).toContain('Needs first');
		expect(html).toContain('Sign off the RCA');
		expect(html).toContain('Show form preview');
		expect(html).not.toContain('<input type="text"');
	});

	it('renders the map tab for a workspace', () => {
		const html = pageFor('ws=acme/eng/sre&p=map');
		expect(html).toContain('Process map');
		expect(html).toContain('0 shared fact types');
	});
});
