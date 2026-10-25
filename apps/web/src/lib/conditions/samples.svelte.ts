/**
 * Sample values for testing conditions, one set per process while the editor is open, so values
 * filled in for one condition are there when testing the next. Nothing here is saved.
 */
import type { CaseFacts } from '@casebook/store';
import { todayIso } from './conditions';

export class Samples {
	/** The value of each fact, by fact id; a fact that is absent counts as not recorded. */
	values = $state<Record<string, unknown>>({});
	/** The day `today()` reads, as YYYY-MM-DD. */
	asOf = $state(todayIso());
	/** The case the values were filled from, while they are unchanged. */
	from = $state<string | undefined>();
	/** The cases running the process, once loaded. */
	cases = $state<CaseFacts[] | undefined>();
}

// Not reactive itself: each process's Samples is, and is made once on first use.
const all: Record<string, Samples> = {};

/** The sample values for a process, keyed by its slug. */
export function samplesFor(process: string): Samples {
	return (all[process] ??= new Samples());
}

/** Loads the cases running a process once, so a test can fill its values from one. */
export async function loadCases(instance: string, process: string): Promise<CaseFacts[]> {
	const samples = samplesFor(process);
	if (samples.cases) return samples.cases;
	const response = await fetch(
		`/i/${encodeURIComponent(instance)}/processes/edit/cases?p=${encodeURIComponent(process)}`
	);
	if (!response.ok) throw new Error('The cases could not be loaded');
	samples.cases = (await response.json()) as CaseFacts[];
	return samples.cases;
}
