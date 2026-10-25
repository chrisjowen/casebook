import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { checkPublish, type DefinitionDocument } from '@casebook/model';
import { birthRegistrationAbroad, incidentManagement } from '@casebook/model/fixtures';
import Page from './+page.svelte';
import { indexDocument, labelOf } from '$lib/graph/derive';
import { namespaceLabel } from '$lib/server/definitions';
import type { LoadedDefinition, Permission, Workspace } from '$lib/definitions/types';

const allow: Permission = { allowed: true, reason: 'user "Olive Owner" is account-owner' };
const deny: Permission = {
	allowed: false,
	reason: 'user "Rae Reader" cannot edit the draft of definition "incident-management"'
};

/** Page data as the server load builds it, from the fixtures instead of Postgres. */
function workspaces(can: Permission): Workspace[] {
	const loaded = (
		document: DefinitionDocument,
		policy: 'governed' | 'living'
	): LoadedDefinition => {
		const check = checkPublish(document);
		return {
			id: document.slug,
			document,
			ok: check.ok,
			errors: check.errors,
			issues: check.issues,
			policy,
			requiresApproval: false,
			revision: 1,
			undoable: false,
			published: { version: 1, at: '2026-10-25T00:00:00.000Z', by: 'Olive Owner' },
			changes: [],
			can: { edit: can, publish: can }
		};
	};
	return [
		[incidentManagement, 'governed'] as const,
		[birthRegistrationAbroad, 'living'] as const
	].map(([document, policy]) => ({
		id: document.namespace,
		namespace: document.namespace,
		label: namespaceLabel(document.namespace),
		definitions: [loaded(document, policy)],
		can: { create: can }
	}));
}

const pageFor = (query: string, can: Permission = allow) => {
	const url = new URL(`http://localhost/?${query}`);
	const ws = workspaces(can);
	const workspace = ws.find((w) => w.namespace === url.searchParams.get('ws')) ?? ws[0]!;
	const p = url.searchParams.get('p');
	const data = {
		user: { id: 'u', displayName: 'Olive Owner', roles: ['account-owner of acme'] },
		workspaces: ws,
		namespace: workspace.namespace,
		slug: p === 'map' ? undefined : (p ?? workspace.definitions[0]!.document.slug),
		view: 'cards' as const,
		selected: url.searchParams.get('sel') ?? undefined
	};
	return render(Page, { props: { data, params: {} } as never }).body;
};

describe('editor route', () => {
	const definitions = workspaces(allow).flatMap((w) =>
		w.definitions.map((d) => ({ namespace: w.namespace, document: d.document }))
	);

	it('every fixture passes its publish checks', () => {
		for (const w of workspaces(allow)) for (const d of w.definitions) expect(d.ok).toBe(true);
	});

	it.each(definitions)(
		'renders $document.slug with its process and every step',
		({ namespace, document }) => {
			const html = pageFor(new URLSearchParams({ ws: namespace, p: document.slug }).toString());
			const ix = indexDocument(document);
			expect(html).toContain(labelOf(ix, ix.process?.core.id));
			for (const item of ix.work) expect(html).toContain(labelOf(ix, item.core.id));
			expect(html).toContain('Editing draft');
			expect(html).toContain('Olive Owner');
		}
	);

	it('shows a read-only inspector, with the reason, to someone who cannot edit', () => {
		const html = pageFor('ws=acme/eng/sre&p=incident-management&sel=step.write-rca', deny);
		expect(html).toContain('Needs first');
		expect(html).toContain('Sign off the RCA');
		expect(html).toContain('Show form preview');
		expect(html).toContain('Read only');
		expect(html).toContain('Rae Reader');
		expect(html).not.toContain('<input type="text"');
	});

	it('makes the inspector fields editable for someone who can edit', () => {
		const html = pageFor('ws=acme/eng/sre&p=incident-management&sel=step.write-rca');
		expect(html).toContain('<input type="text"');
		expect(html).toContain('Collect another fact');
		expect(html).toContain('Need another fact first');
	});

	it('offers publishing for a governed process and explains a living one', () => {
		const governed = pageFor('ws=acme/eng/sre&p=incident-management&sel=');
		expect(governed).toContain('Publish');
		const living = pageFor('ws=personal/example-user/family&p=birth-registration-abroad', allow);
		expect(living).toContain('Living');
	});

	it('renders the map tab for a workspace', () => {
		const html = pageFor('ws=acme/eng/sre&p=map');
		expect(html).toContain('Process map');
		expect(html).toContain('0 shared fact types');
	});
});
