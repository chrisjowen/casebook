import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LoadedDefinition } from '$lib/definitions/types';
import { Editor } from './editing.svelte';

const page = vi.hoisted(() => ({ revision: 1 }));

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
		can: { edit: allow, publish: allow }
	}) as unknown as LoadedDefinition;

const posted: Record<string, string>[] = [];

function stubServer() {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (_url: string, init: RequestInit) => {
			const fields = Object.fromEntries(init.body as FormData) as Record<string, string>;
			posted.push(fields);
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
});
