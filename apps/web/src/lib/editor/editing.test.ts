import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LoadedDefinition } from '$lib/definitions/types';
import { Editor } from './editing.svelte';

const page = vi.hoisted(() => ({
	revision: 1,
	issues: [] as { severity: string; message: string }[]
}));

vi.mock('$app/forms', () => ({ deserialize: (text: string) => JSON.parse(text) }));
vi.mock('$app/navigation', () => ({
	invalidateAll: vi.fn(async () => {
		page.revision++;
	})
}));

const allow = { allowed: true, reason: '' };
const definition = () =>
	({
		id: 'def-1',
		policy: 'governed',
		revision: page.revision,
		undoable: page.revision > 1,
		issues: page.revision > 1 ? page.issues : [],
		can: { edit: allow, publish: allow }
	}) as unknown as LoadedDefinition;

const posted: Record<string, string>[] = [];

function stubServer() {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init: RequestInit) => {
			const fields = Object.fromEntries(init.body as FormData) as Record<string, string>;
			posted.push({ ...fields, action: url });
			await new Promise((resolve) => setTimeout(resolve, 5));
			const stale = Number(fields.baseRevision) !== page.revision;
			return new Response(
				JSON.stringify(
					stale
						? { type: 'failure', status: 409, data: { reason: 'The draft has moved on' } }
						: { type: 'success', status: 200, data: {} }
				)
			);
		})
	);
}

afterEach(() => {
	vi.unstubAllGlobals();
	posted.length = 0;
	page.revision = 1;
	page.issues = [];
});

describe('Editor', () => {
	it('saves an edit made while another is still saving, against the reloaded revision', async () => {
		stubServer();
		const editor = new Editor(definition);
		const first = editor.apply([{ op: 'set_content', id: 'a', content: 'one' } as never]);
		expect(editor.busy).toBe(true);
		const second = editor.apply([{ op: 'set_content', id: 'b', content: 'two' } as never]);
		expect(await first).toBe(true);
		expect(await second).toBe(true);
		expect(posted.map((p) => p.baseRevision)).toEqual(['1', '2']);
		expect(editor.busy).toBe(false);
		expect(editor.notice).toBeUndefined();
	});

	it('resolves false with the reason when the server refuses', async () => {
		stubServer();
		page.revision = 3;
		const editor = new Editor(() => ({ ...definition(), revision: 2 }));
		expect(await editor.apply([])).toBe(false);
		expect(editor.notice?.text).toBe('The draft has moved on');
		expect(editor.busy).toBe(false);
	});

	it('says what a labelled edit did and offers Undo, which posts the undo action', async () => {
		stubServer();
		const editor = new Editor(definition);
		expect(
			await editor.apply(
				[{ op: 'set_content', id: 'a', content: 'x' } as never],
				'Added Build to Next'
			)
		).toBe(true);
		expect(editor.notice).toMatchObject({ tone: 'info', text: 'Added Build to Next.', undo: true });
		expect(editor.undoable).toBe(true);
		await editor.undo();
		expect(posted.map((p) => p.action)).toEqual(['?/edit', '?/undo']);
		expect(editor.notice?.text).toBe('Undid the last edit');
	});

	it('warns when a saved edit leaves something that blocks publishing', async () => {
		stubServer();
		page.issues = [{ severity: 'error', message: 'Report and Classify wait for each other' }];
		const editor = new Editor(definition);
		expect(
			await editor.apply([{ op: 'set_content', id: 'a', content: 'x' } as never], 'Linked them')
		).toBe(true);
		expect(editor.notice).toMatchObject({
			tone: 'warn',
			text: 'Linked them, but publishing is now blocked',
			details: ['Report and Classify wait for each other'],
			undo: true
		});
	});

	it('shows why a gesture cannot be done without sending anything', () => {
		stubServer();
		const editor = new Editor(definition);
		editor.refuse('Detect is already the first stage');
		expect(editor.notice).toMatchObject({
			tone: 'error',
			text: 'Detect is already the first stage'
		});
		expect(posted).toEqual([]);
	});
});
