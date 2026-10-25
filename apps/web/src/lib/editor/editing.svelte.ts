/**
 * Client side of editing: posts edits, undo, publish and create to the page's form actions, which
 * act as the signed-in user, then reloads the page data. Refusals show as a notice with the
 * server's plain-language reason.
 */
import { getContext, setContext } from 'svelte';
import { deserialize } from '$app/forms';
import { invalidateAll } from '$app/navigation';
import type { Operation } from '@casebook/model';
import type { LoadedDefinition } from '$lib/definitions/types';

export interface Notice {
	tone: 'error' | 'info';
	text: string;
	/** Extra lines, such as the publish checks that failed. */
	details?: string[];
}

interface Failure {
	reason?: string;
	problems?: string[];
}

export class Editor {
	notice = $state<Notice | undefined>();
	#pending = $state(0);
	#queue: Promise<unknown> = Promise.resolve();
	#timer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		/** The open definition. */
		private readonly current: () => LoadedDefinition | undefined
	) {}

	/** Whether a request is running or waiting its turn. */
	get busy() {
		return this.#pending > 0;
	}

	get definition() {
		return this.current();
	}

	/** Why the open definition cannot be edited right now, or undefined when it can. */
	get blocked(): string | undefined {
		const definition = this.current();
		if (!definition) return 'No process is open';
		if (!definition.can.edit.allowed) return definition.can.edit.reason;
		if (definition.policy === 'living' && !definition.can.publish.allowed) {
			return `Every edit of a living process is published, and ${definition.can.publish.reason}`;
		}
		return undefined;
	}

	/** Saves `ops` as one edit of the open draft. Resolves true when it was saved. */
	async apply(ops: Operation[]): Promise<boolean> {
		const result = await this.#submit('edit', () => {
			const definition = this.definition;
			if (!definition || this.blocked) return undefined;
			return {
				definitionId: definition.id,
				baseRevision: String(definition.revision ?? 0),
				ops: JSON.stringify(ops)
			};
		});
		if (result?.version !== undefined) this.#say('info', `Published as version ${result.version}`);
		return result !== undefined;
	}

	async undo(): Promise<void> {
		const result = await this.#submit('undo', () => {
			const definition = this.definition;
			if (!definition || this.blocked) return undefined;
			return { definitionId: definition.id, baseRevision: String(definition.revision ?? 0) };
		});
		if (result) this.#say('info', 'Undid the last edit');
	}

	async publish(): Promise<void> {
		const result = await this.#submit('publish', () => {
			const definition = this.definition;
			if (!definition) return undefined;
			return { definitionId: definition.id, baseRevision: String(definition.revision ?? 0) };
		});
		if (result?.version !== undefined) this.#say('info', `Published version ${result.version}`);
	}

	/** Creates a process in a namespace and resolves its slug. */
	async create(
		namespaceId: string,
		title: string,
		changePolicy: 'governed' | 'living'
	): Promise<string | undefined> {
		const result = await this.#submit('create', () => ({ namespaceId, title, changePolicy }));
		return typeof result?.slug === 'string' ? result.slug : undefined;
	}

	dismiss() {
		this.notice = undefined;
	}

	/**
	 * Queues a request behind any still running, so each is sent against the page as the one before
	 * it left it. `fields` is read when the request's turn comes; undefined skips it.
	 */
	#submit(
		action: string,
		fields: () => Record<string, string> | undefined
	): Promise<Record<string, unknown> | undefined> {
		this.#pending++;
		const run = this.#queue.then(async () => {
			try {
				const values = fields();
				return values && (await this.#post(action, values));
			} finally {
				this.#pending--;
			}
		});
		this.#queue = run;
		return run;
	}

	async #post(
		action: string,
		fields: Record<string, string>
	): Promise<Record<string, unknown> | undefined> {
		try {
			const body = new FormData();
			for (const [key, value] of Object.entries(fields)) body.set(key, value);
			const response = await fetch(`?/${action}`, {
				method: 'POST',
				body,
				headers: { 'x-sveltekit-action': 'true' }
			});
			const result = deserialize(await response.text());
			if (result.type === 'success') {
				this.notice = undefined;
				await invalidateAll();
				return result.data ?? {};
			}
			if (result.type === 'failure') {
				const data = (result.data ?? {}) as Failure;
				this.#say('error', data.reason ?? 'That did not work', data.problems);
			} else if (result.type === 'error') {
				this.#say('error', String((result.error as Error)?.message ?? 'Something went wrong'));
			}
			return undefined;
		} catch (error) {
			this.#say('error', error instanceof Error ? error.message : String(error));
			return undefined;
		}
	}

	#say(tone: Notice['tone'], text: string, details?: string[]) {
		clearTimeout(this.#timer);
		this.notice = { tone, text, ...(details?.length ? { details } : {}) };
		if (tone === 'info') this.#timer = setTimeout(() => (this.notice = undefined), 3500);
	}
}

const KEY = Symbol('casebook-editor');

export const setEditor = (editor: Editor) => setContext(KEY, editor);
export const getEditor = () => getContext<Editor | undefined>(KEY);
