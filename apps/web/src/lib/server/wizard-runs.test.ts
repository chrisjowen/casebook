import { afterEach, describe, expect, it } from 'vitest';
import { isRunning, progressOf, runTurn, TurnTimeout } from './wizard-runs';

const later = () => {
	let open!: () => void;
	const gate = new Promise<void>((r) => (open = r));
	return { gate, open };
};

afterEach(() => {
	delete process.env.CASEBOOK_WIZARD_TIMEOUT_SECONDS;
	delete process.env.CASEBOOK_WIZARD_MODEL;
});

describe('agent turns', () => {
	it('on Ollama run one at a time, showing what each is doing and that the next is waiting', async () => {
		process.env.CASEBOOK_WIZARD_MODEL = 'ollama:qwen2.5:7b';
		const first = later();
		const a = runTurn('s1', 'u1', async ({ onProgress, onLive }) => {
			onProgress('Proposing 2 processes');
			onLive({
				text: 'I will propose one process per sheet.',
				items: [
					{ kind: 'process', title: 'Birth registration' },
					{ kind: 'process', title: 'Medical claims' }
				]
			});
			await first.gate;
			return 'a';
		});
		const b = runTurn('s2', 'u1', async () => 'b');
		await new Promise((r) => setTimeout(r, 10));
		expect(progressOf('s1', 'u1')).toMatchObject({
			activity: 'Proposing 2 processes',
			waiting: false,
			text: 'I will propose one process per sheet.',
			items: [
				{ kind: 'process', title: 'Birth registration' },
				{ kind: 'process', title: 'Medical claims' }
			]
		});
		expect(progressOf('s2', 'u1')).toMatchObject({ text: '', items: [] });
		expect(progressOf('s2', 'u1')).toMatchObject({ waiting: true });
		expect(progressOf('s2', 'u1')?.activity).toMatch(/another request is ahead of this one/);
		expect(progressOf('s1', 'someone-else')).toBeUndefined();
		first.open();
		expect(await Promise.all([a, b])).toEqual(['a', 'b']);
		expect(isRunning('s1') || isRunning('s2')).toBe(false);
	});

	it('stop a turn that runs past the timeout', async () => {
		process.env.CASEBOOK_WIZARD_TIMEOUT_SECONDS = '0.05';
		const stuck = runTurn(
			's3',
			'u1',
			({ signal }) =>
				new Promise((_, reject) =>
					signal.addEventListener('abort', () => reject(new Error('aborted')))
				)
		);
		await expect(stuck).rejects.toBeInstanceOf(TurnTimeout);
		expect(isRunning('s3')).toBe(false);
		// The next turn still runs.
		expect(await runTurn('s4', 'u1', async () => 'next')).toBe('next');
	});

	it('stop a turn that waited past the timeout without running it', async () => {
		process.env.CASEBOOK_WIZARD_MODEL = 'ollama:qwen2.5:7b';
		const first = later();
		const a = runTurn('s5', 'u1', async ({ signal }) => {
			await first.gate;
			signal.throwIfAborted();
			return 'a';
		});
		process.env.CASEBOOK_WIZARD_TIMEOUT_SECONDS = '0.05';
		let ran = false;
		const b = runTurn('s6', 'u1', async () => {
			ran = true;
			return 'b';
		});
		await new Promise((r) => setTimeout(r, 100));
		first.open();
		expect(await a).toBe('a');
		await expect(b).rejects.toBeInstanceOf(TurnTimeout);
		expect(ran).toBe(false);
	});

	it('on a hosted model run side by side', async () => {
		process.env.CASEBOOK_WIZARD_MODEL = 'anthropic:claude-sonnet-5';
		const first = later();
		const a = runTurn('s7', 'u1', async () => {
			await first.gate;
			return 'a';
		});
		const b = runTurn('s8', 'u1', async () => 'b');
		expect(progressOf('s7', 'u1')).toMatchObject({ waiting: false });
		expect(await b).toBe('b');
		first.open();
		expect(await a).toBe('a');
	});
});
