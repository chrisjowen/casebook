import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isHttpError, isRedirect } from '@sveltejs/kit';
import { findCaseFile, listDefinitions, listInstances, startCase } from '@casebook/store';
import { readForm } from './task-actions';
import { load as instanceLayout } from '../../routes/i/[instance]/+layout.server';
import { GET as home } from '../../routes/+server';
import { GET as file } from '../../routes/files/[id]/+server';
import { actions as newCase } from '../../routes/i/[instance]/cases/new/+page.server';
import { acme, family, user } from '$lib/runner/test-data';

vi.mock('$lib/server/db', () => ({ getDb: () => ({}) }));
vi.mock('$lib/server/session', () => ({ devSignInEnabled: () => true }));
vi.mock('./runner', async (importOriginal) => ({
	...(await importOriginal<typeof import('./runner')>()),
	fileStore: () => ({ get: async () => new TextEncoder().encode('<script>alert(1)</script>') })
}));
vi.mock('@casebook/store', async (importOriginal) => ({
	...(await importOriginal<typeof import('@casebook/store')>()),
	listInstances: vi.fn(),
	listDefinitions: vi.fn(),
	findCaseFile: vi.fn(),
	startCase: vi.fn()
}));

const locals = { user };

async function thrown(run: () => unknown) {
	try {
		await run();
	} catch (error) {
		return error;
	}
	throw new Error('expected it to throw');
}

beforeEach(() => vi.clearAllMocks());

describe('reading a task form', () => {
	it('collects repeated values, reads times as UTC, and skips empty file inputs', async () => {
		const form = new FormData();
		form.append('value:fact.working-group', 'a');
		form.append('value:fact.working-group', 'b');
		form.append('value:fact.resolved-at', '2026-10-25T10:30');
		form.append('file:fact:fact.rca-document', new File([], ''));
		form.append('file:evidence:0', new File(['scan'], 'scan.pdf', { type: 'application/pdf' }));
		const { values, files } = await readForm(form);
		expect(values).toEqual({
			'fact.working-group': ['a', 'b'],
			'fact.resolved-at': ['2026-10-25T10:30:00.000Z']
		});
		expect(files).toMatchObject([
			{ slot: 'evidence:0', name: 'scan.pdf', contentType: 'application/pdf' }
		]);
	});

	it('makes a demo document only when asked, and never over an upload', async () => {
		const form = new FormData();
		form.append('demo:fact:fact.application-form', 'yes');
		form.append('demo-name:fact:fact.application-form', 'Completed application form');
		const { files } = await readForm(form);
		expect(files).toMatchObject([
			{ slot: 'fact:fact.application-form', name: 'completed-application-form.pdf' }
		]);
		expect(new TextDecoder().decode(files[0]!.bytes)).toMatch(/^%PDF-1\.4/);
	});
});

describe('instances', () => {
	it('sends a guest, who belongs to no casebook, to their requests', async () => {
		vi.mocked(listInstances).mockResolvedValue([]);
		const error = await thrown(() =>
			instanceLayout({ params: { instance: 'example-family' }, locals } as never)
		);
		expect(isRedirect(error) && error.location).toBe('/requests');
	});

	it('refuses a casebook the user is not a member of', async () => {
		vi.mocked(listInstances).mockResolvedValue([acme]);
		const error = await thrown(() =>
			instanceLayout({ params: { instance: 'example-family' }, locals } as never)
		);
		expect(isHttpError(error) && error.status).toBe(403);
	});

	it('opens home on the casebook that has work waiting', async () => {
		vi.mocked(listInstances).mockResolvedValue([acme, family]);
		const error = await thrown(() => home({ url: new URL('http://localhost/'), locals } as never));
		expect(isRedirect(error) && error.location).toBe('/i/example-family');
	});

	it('opens an old editor link in the instance that owns the namespace', async () => {
		vi.mocked(listDefinitions).mockResolvedValue([
			{ namespace: { id: 'n', accountId: 'a', accountSlug: 'acme', path: 'acme/eng/sre' } } as never
		]);
		const error = await thrown(() =>
			home({
				url: new URL('http://localhost/?ws=acme/eng/sre&p=incident-management'),
				locals
			} as never)
		);
		expect(isRedirect(error) && error.location).toBe(
			'/i/acme/processes/edit?ws=acme%2Feng%2Fsre&p=incident-management'
		);
	});
});

describe('starting a case', () => {
	it('refuses a guest who posts the form, and starts nothing', async () => {
		vi.mocked(startCase).mockResolvedValue({
			ok: false,
			code: 'access-denied',
			reason: 'Dana Cole cannot start a case of definition "medical-bill-claim"',
			problems: []
		});
		const guest = { user: { id: 'dana', displayName: 'Dana Cole', roles: [] } };
		const form = new FormData();
		form.append('process', 'def-claim');
		form.append('title', 'A bill of my own');
		form.append('role:role.claimant', 'alex');
		const result = await newCase.default!({
			request: new Request('http://localhost/i/example-family/cases/new', {
				method: 'POST',
				body: form
			}),
			locals: guest,
			params: { instance: 'example-family' }
		} as never);
		expect(startCase).toHaveBeenCalledWith(
			expect.anything(),
			{ id: 'dana' },
			expect.objectContaining({ definitionId: 'def-claim', roles: { 'role.claimant': ['alex'] } })
		);
		expect(result).toMatchObject({ status: 403, data: { code: 'access-denied' } });
	});
});

describe('case files', () => {
	it('downloads anything a browser could run, and sandboxes every file', async () => {
		vi.mocked(findCaseFile).mockResolvedValue({
			name: 'notes.html',
			contentType: 'text/html',
			storageKey: 'ab/key'
		});
		const response = await file({ params: { id: 'f' }, locals } as never);
		expect(response.headers.get('content-type')).toBe('application/octet-stream');
		expect(response.headers.get('content-disposition')).toMatch(/^attachment;/);
		expect(response.headers.get('content-security-policy')).toBe('sandbox');
	});

	it('shows a PDF in place, and refuses a file the user may not open', async () => {
		vi.mocked(findCaseFile).mockResolvedValueOnce({
			name: 'rca.pdf',
			contentType: 'application/pdf',
			storageKey: 'ab/key'
		});
		const response = await file({ params: { id: 'f' }, locals } as never);
		expect(response.headers.get('content-disposition')).toMatch(/^inline;/);
		vi.mocked(findCaseFile).mockResolvedValueOnce({ ok: false, code: 'not-found', reason: 'no' });
		const error = await thrown(() => file({ params: { id: 'g' }, locals } as never));
		expect(isHttpError(error) && error.status).toBe(404);
	});
});
