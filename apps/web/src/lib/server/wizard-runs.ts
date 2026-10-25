/**
 * Agent turns in progress, in this server process. A local model answers one request at a time,
 * so turns run one after another; each one's progress can be read while it runs, so the assistant
 * never sits silently, and a turn that runs too long is stopped.
 */
import { modelName } from '@casebook/wizard-agent';

/** How long one agent turn may run before it is stopped, from CASEBOOK_WIZARD_TIMEOUT_SECONDS. */
export function turnTimeoutSeconds(): number {
	const set = Number(process.env.CASEBOOK_WIZARD_TIMEOUT_SECONDS);
	return Number.isFinite(set) && set > 0 ? set : 480;
}

/** What a running or waiting turn is doing, as the assistant shows it. */
export interface RunProgress {
	/** Such as `Thinking (step 2)`, or why it is waiting. */
	activity: string;
	waiting: boolean;
	/** Seconds since the request arrived. */
	seconds: number;
}

interface Run {
	ownerId: string;
	activity: string;
	waiting: boolean;
	startedAt: number;
}

const runs = new Map<string, Run>();
let tail: Promise<unknown> = Promise.resolve();
let queued = 0;

/** Thrown when a turn is stopped for running longer than the timeout. */
export class TurnTimeout extends Error {
	override name = 'TurnTimeout';
}

/** The turn running or waiting for an import, if any, as its owner sees it. */
export function progressOf(sessionId: string, ownerId: string): RunProgress | undefined {
	const run = runs.get(sessionId);
	if (!run || run.ownerId !== ownerId) return undefined;
	return {
		activity: run.activity,
		waiting: run.waiting,
		seconds: Math.round((Date.now() - run.startedAt) / 1000)
	};
}

/** Whether an import has a turn running or waiting. */
export const isRunning = (sessionId: string) => runs.has(sessionId);

/**
 * Runs `work` once the turns before it have finished, with a signal that stops it after the
 * timeout and a callback that records its progress.
 */
export async function runTurn<T>(
	sessionId: string,
	ownerId: string,
	work: (turn: { signal: AbortSignal; onProgress: (activity: string) => void }) => Promise<T>
): Promise<T> {
	const ahead = queued;
	const run: Run = {
		ownerId,
		activity:
			ahead > 0
				? `Waiting for the model (${modelName()}): ${ahead === 1 ? 'another request is' : `${ahead} requests are`} ahead of this one`
				: 'Starting',
		waiting: ahead > 0,
		startedAt: Date.now()
	};
	runs.set(sessionId, run);
	queued++;
	const start = tail.catch(() => undefined);
	const result = start.then(async () => {
		run.waiting = false;
		run.activity = 'Starting';
		const controller = new AbortController();
		const seconds = turnTimeoutSeconds();
		const timer = setTimeout(
			() => controller.abort(new TurnTimeout(`stopped after ${seconds} seconds`)),
			seconds * 1000
		);
		try {
			return await work({
				signal: controller.signal,
				onProgress: (activity) => (run.activity = activity)
			});
		} catch (error) {
			if (controller.signal.aborted) throw controller.signal.reason;
			throw error;
		} finally {
			clearTimeout(timer);
		}
	});
	tail = result;
	try {
		return await result;
	} finally {
		queued--;
		runs.delete(sessionId);
	}
}
