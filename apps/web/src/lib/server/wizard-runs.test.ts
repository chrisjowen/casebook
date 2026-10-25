import { afterEach, describe, expect, it } from 'vitest';
import { isRunning, progressOf, runTurn, TurnTimeout } from './wizard-runs';

const later = () => {
	let open!: () => void;
	const gate = new Promise<void>((r) => (open = r));
	return { gate, open };
};

afterEach(() => {
	delete process.env.CASEBOOK_WIZARD_TIMEOUT_SECONDS;
});

describe('agent turns', () => {
	it('run one at a time, showing what each is doing and that the next is waiting', async () => {
		const first = later();
		const a = runTurn('s1', 'u1', async ({ onProgress }) => {
			onProgress('Thinking (step 2)');
			await first.gate;
			return 'a';
		});
		const b = runTurn('s2', 'u1', async () => 'b');
		await new Promise((r) => setTimeout(r, 10));
		expect(progressOf('s1', 'u1')).toMatchObject({ activity: 'Thinking (step 2)', waiting: false });
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
});
