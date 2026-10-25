import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { checkPublish, type DefinitionDocument } from '@casebook/model';
import { birthRegistrationAbroad, incidentManagement } from '@casebook/model/fixtures';
import Page from './+page.svelte';
import { indexDocument, labelOf } from '$lib/graph/derive';
import { loadWorkspaces, namespaceLabel } from '$lib/server/definitions';
import type { LoadedDefinition, Permission, Workspace } from '$lib/definitions/types';
import { load } from './+page.server';
import { listImports, loadWizard } from '$lib/server/wizard';
import type { WizardView } from '$lib/wizard/types';
import { proposeSplit, proposeTurn, say, splitAccepted, startState } from '@casebook/wizard-agent';

vi.mock('$lib/server/definitions', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/definitions')>()),
	loadWorkspaces: vi.fn()
}));

vi.mock('$lib/server/wizard', () => ({ loadWizard: vi.fn(), listImports: vi.fn() }));

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
		url: new URL(`http://localhost/i/acme/processes/edit?${query}`),
		params: { instance: 'acme' },
		locals: { user }
	} as never);
	if (!data) throw new Error('load returned nothing');
	return data;
};

const pageFor = async (query: string, can: Permission = allow) =>
	render(Page, { props: { data: await dataFor(query, can), params: {} } as never }).body;

beforeEach(() => {
	vi.mocked(loadWorkspaces).mockReset();
	vi.mocked(loadWizard).mockReset().mockResolvedValue(undefined);
	vi.mocked(listImports).mockReset().mockResolvedValue([]);
});

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

describe('spreadsheet import', () => {
	const sre = 'acme/eng/sre';
	const view = (state: WizardView['state'], extra: Partial<WizardView> = {}): WizardView => ({
		id: 'w1',
		version: 3,
		fileName: 'newborn-tracker.xlsx',
		namespaceId: sre,
		model: 'ollama:qwen2.5:7b',
		state,
		ranges: { p2: ['"Birth reg" A2:G7 · 6 rows'], p3: ['"Claims" A2:F8 · 7 rows'] },
		...extra
	});
	const proposed = proposeSplit(startState('newborn-tracker.xlsx'), {
		processes: [
			{ title: 'Birth registration', summary: 'Register the birth', sources: [] },
			{ title: 'Medical claims', summary: 'Claim the bills', sources: [] }
		],
		shared: [{ title: 'Shared document set', summary: 'Documents', sources: [] }]
	});
	const split = say(proposed, 'assistant', 'Two processes.', { type: 'split' });

	it('offers the import beside the process tabs, with the reason when it is not allowed', async () => {
		expect(await pageFor(`ws=${sre}`)).toContain('Import a spreadsheet');
		expect(await pageFor(`ws=${sre}`, deny)).toContain(
			`Import a spreadsheet: ${deny.reason.replaceAll('"', '&quot;')}`
		);
	});

	it('shows the split to choose, with rename, merge and accept, in place of the board', async () => {
		vi.mocked(loadWizard).mockResolvedValue(view(split));
		const html = await pageFor(`ws=${sre}&wizard=w1`);
		expect(html).toContain('Choose the processes');
		expect(html).toContain('aria-label="Assistant"');
		expect(html).toContain('Birth registration');
		expect(html).toContain('A2:G7 · 6 rows');
		expect(html).toContain('Rename');
		expect(html).toContain('aria-label="Merge Birth registration into"');
		expect(html).toContain('Shared document set');
		expect(html).toContain('Accept split');
		expect(html).toContain('ollama:qwen2.5:7b');
		expect(html).not.toContain('aria-label="Add to Respond"');
	});

	it('draws a pending proposal on the board, marked, with Accept and Reject', async () => {
		const drafting = proposeTurn(
			splitAccepted(split, [
				{
					key: 'p2',
					title: 'Incident management',
					definitionId: 'incident-management',
					slug: incidentManagement.slug,
					sources: [],
					drafted: false
				}
			]),
			'p2',
			[],
			'I added a step to notify the customer.'
		);
		const document: DefinitionDocument = {
			...incidentManagement,
			nodes: [
				...incidentManagement.nodes,
				{
					core: {
						id: 'step.notify-customer',
						kind: 'step',
						title: 'Notify the customer',
						stage: 'stage.respond',
						role: 'role.incident-commander',
						actor: 'human'
					}
				}
			]
		};
		vi.mocked(loadWizard).mockResolvedValue(
			view(drafting, {
				preview: {
					ok: true,
					processKey: 'p2',
					turnId: drafting.turns[0]!.id,
					revision: 1,
					document,
					changes: [
						{
							kind: 'added',
							summary: 'Added step Notify the customer',
							nodeId: 'step.notify-customer'
						}
					],
					marks: { 'step.notify-customer': 'new' },
					blocking: []
				}
			})
		);
		const html = await pageFor(`ws=${sre}&p=incident-management&wizard=w1`);
		expect(html).toContain('Notify the customer');
		expect(html).toContain('>New<');
		expect(html).toMatch(/1\s+change from the assistant/);
		expect(html).toContain('Added step Notify the customer');
		expect(html).toContain('Shown on the board');
		expect(html).toContain('· not drafted');
		// The board is for reviewing while a proposal is open, not for editing.
		expect(html).not.toContain('Add stage');
	});
});
