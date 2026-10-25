import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { checkPublish, type DefinitionDocument } from '@casebook/model';
import { birthRegistrationAbroad, incidentManagement } from '@casebook/model/fixtures';
import Page from './+page.svelte';
import { indexDocument, labelOf } from '$lib/graph/derive';
import { loadWorkspaces, namespaceLabel } from '$lib/server/definitions';
import type { LoadedDefinition, Permission, Workspace } from '$lib/definitions/types';
import { load } from './+page.server';

vi.mock('$lib/server/definitions', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/definitions')>()),
	loadWorkspaces: vi.fn()
}));

const allow: Permission = { allowed: true, reason: 'user "Olive Owner" is account-owner' };
const deny: Permission = {
	allowed: false,
	reason: 'user "Rae Reader" cannot edit the draft of definition "incident-management"'
};

/**
 * Workspaces as `loadWorkspaces` returns them, from the fixtures instead of Postgres. An empty
 * workspace comes first, as a readable namespace with no processes would.
 */
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
	const empty: Workspace = {
		id: 'acme',
		namespace: 'acme',
		label: namespaceLabel('acme'),
		definitions: [],
		can: { create: can }
	};
	return [
		empty,
		...[
			[incidentManagement, 'governed'] as const,
			[birthRegistrationAbroad, 'living'] as const
		].map(([document, policy]) => ({
			id: document.namespace,
			namespace: document.namespace,
			label: namespaceLabel(document.namespace),
			definitions: [loaded(document, policy)],
			can: { create: can }
		}))
	];
}

const user = { id: 'u', displayName: 'Olive Owner', roles: ['account-owner of acme'] };

/** Page data from the real server load, with the workspaces for `can`. */
const dataFor = async (query: string, can: Permission = allow) => {
	vi.mocked(loadWorkspaces).mockResolvedValue(workspaces(can));
	const data = await load({
		url: new URL(`http://localhost/?${query}`),
		locals: { user }
	} as never);
	if (!data) throw new Error('load returned nothing');
	return data;
};

const pageFor = async (query: string, can: Permission = allow) =>
	render(Page, { props: { data: await dataFor(query, can), params: {} } as never }).body;

beforeEach(() => vi.mocked(loadWorkspaces).mockReset());

describe('editor route', () => {
	const definitions = workspaces(allow).flatMap((w) =>
		w.definitions.map((d) => ({ namespace: w.namespace, document: d.document }))
	);

	it('every fixture passes its publish checks', () => {
		for (const w of workspaces(allow)) for (const d of w.definitions) expect(d.ok).toBe(true);
	});

	it.each(definitions)(
		'renders $document.slug with its process and every step',
		async ({ namespace, document }) => {
			const html = await pageFor(
				new URLSearchParams({ ws: namespace, p: document.slug }).toString()
			);
			const ix = indexDocument(document);
			expect(html).toContain(labelOf(ix, ix.process?.core.id));
			for (const item of ix.work) expect(html).toContain(labelOf(ix, item.core.id));
			expect(html).toContain('Editing draft');
			expect(html).toContain('Olive Owner');
		}
	);

	it('shows a read-only inspector, with the reason, to someone who cannot edit', async () => {
		const html = await pageFor('ws=acme/eng/sre&p=incident-management&sel=step.write-rca', deny);
		expect(html).toContain('Needs first');
		expect(html).toContain('Sign off the RCA');
		expect(html).toContain('Show form preview');
		expect(html).toContain('Read only');
		expect(html).toContain('Rae Reader');
		expect(html).not.toContain('<input type="text"');
	});

	it('makes the inspector fields editable for someone who can edit', async () => {
		const html = await pageFor('ws=acme/eng/sre&p=incident-management&sel=step.write-rca');
		expect(html).toContain('<input type="text"');
		expect(html).toContain('aria-label="Add a fact it records"');
		expect(html).toContain('aria-label="Add something it needs first"');
	});

	it("edits a step's facts in place: rename, change kind and remove in each row", async () => {
		const html = await pageFor('ws=acme/eng/sre&p=incident-management&sel=step.write-rca');
		expect(html).toContain('aria-label="Name of Root cause analysis"');
		expect(html).toContain('aria-label="Remove Root cause analysis"');
		expect(html).toContain('aria-label="Kind of Resolution summary"');
		expect(html).toContain('from Resolve the incident');
		const readOnly = await pageFor(
			'ws=acme/eng/sre&p=incident-management&sel=step.write-rca',
			deny
		);
		expect(readOnly).not.toContain('aria-label="Remove Root cause analysis"');
	});

	it('builds on the board: stage columns with Add step, an Add stage column, and no side tree', async () => {
		const html = await pageFor('ws=acme/eng/sre&p=incident-management');
		for (const stage of indexDocument(incidentManagement).stages) {
			expect(html).toContain(`aria-label="Add to ${stage.core.title}"`);
		}
		expect(html).toContain('Add stage');
		expect(html).toContain('aria-label="Actions for Report the incident"');
		expect(html).toContain('aria-label="Workspace"');
		expect(html).toContain('aria-label="New process"');
		expect(html).not.toContain('aria-label="Outline"');
		expect(html).not.toContain('aria-label="Editor"');
	});

	it('shows the same board without its controls to someone who cannot edit', async () => {
		const html = await pageFor('ws=acme/eng/sre&p=incident-management', deny);
		expect(html).toContain('Report the incident');
		expect(html).not.toContain('Add stage');
		expect(html).not.toContain('aria-label="Actions for Report the incident"');
		expect(html).not.toContain('Add what comes after');
	});

	it("opens a stage's details from the board", async () => {
		const html = await pageFor('ws=acme/eng/sre&p=incident-management&sel=stage.respond');
		expect(html).toContain('In this stage');
		expect(html).toContain('Form the working group');
		expect(html).toContain('Move left');
		expect(html).toContain('Delete stage');
	});

	it('offers publishing for a governed process and explains a living one', async () => {
		const governed = await pageFor('ws=acme/eng/sre&p=incident-management&sel=');
		expect(governed).toContain('Publish');
		const living = await pageFor(
			'ws=personal/example-user/family&p=birth-registration-abroad',
			allow
		);
		expect(living).toContain('Living');
	});

	it('renders the map tab for a workspace', async () => {
		const data = await dataFor('ws=acme/eng/sre&p=map');
		expect(data.namespace).toBe('acme/eng/sre');
		expect(data.slug).toBeUndefined();
		const html = await pageFor('ws=acme/eng/sre&p=map');
		expect(html).toContain('Process map');
		expect(html).toContain('0 shared fact types');
	});

	it('opens the first workspace with processes, and its first process, by default', async () => {
		const data = await dataFor('');
		expect(data.namespace).toBe(incidentManagement.namespace);
		expect(data.slug).toBe(incidentManagement.slug);
		expect(data.view).toBe('board');
		expect(data.user).toBe(user);
	});

	it('falls back to the first process for an unknown slug and to the board for an unknown view', async () => {
		const data = await dataFor(
			`ws=${birthRegistrationAbroad.namespace}&p=no-such-process&view=nonsense&sel=step.x`
		);
		expect(data.namespace).toBe(birthRegistrationAbroad.namespace);
		expect(data.slug).toBe(birthRegistrationAbroad.slug);
		expect(data.view).toBe('board');
		expect(data.selected).toBe('step.x');
	});
});
