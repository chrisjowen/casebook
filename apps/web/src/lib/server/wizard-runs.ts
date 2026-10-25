/**
 * Agent turns in progress, in this server process. A local model answers one request at a time,
 * so with Ollama turns run one after another; a hosted model's turns run side by side. Each one's
 * progress can be read while it runs, so the assistant never sits silently, and a turn still
 * unfinished at the timeout, counted from when its request arrived, is stopped.
 */
import { modelName, modelSpec } from '@casebook/wizard-agent';

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
 * Runs `work`, with Ollama once the turns before it have finished, with a signal that stops it at
 * the timeout from now, waiting included, and a callback that records its progress.
 */
export async function runTurn<T>(
	sessionId: string,
	ownerId: string,
	work: (turn: { signal: AbortSignal; onProgress: (activity: string) => void }) => Promise<T>
): Promise<T> {
	const serial = modelSpec().provider === 'ollama';
	const ahead = serial ? queued : 0;
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
	const controller = new AbortController();
	const seconds = turnTimeoutSeconds();
	const timer = setTimeout(
		() => controller.abort(new TurnTimeout(`stopped after ${seconds} seconds`)),
		seconds * 1000
	);
	const start = serial ? tail.catch(() => undefined) : Promise.resolve();
	const result = start.then(async () => {
		controller.signal.throwIfAborted();
		run.waiting = false;
		run.activity = 'Starting';
		try {
			return await work({
				signal: controller.signal,
				onProgress: (activity) => (run.activity = activity)
			});
		} catch (error) {
			if (controller.signal.aborted) throw controller.signal.reason;
			throw error;
		}
	});
	if (serial) {
		queued++;
		tail = result;
	}
	try {
		return await result;
	} finally {
		clearTimeout(timer);
		if (serial) queued--;
		runs.delete(sessionId);
	}
}
