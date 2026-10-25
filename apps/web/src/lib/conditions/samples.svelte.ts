/**
 * Sample values for testing conditions, one set per process while the editor is open, so values
 * filled in for one condition are there when testing the next. Nothing here is saved.
 */
import type { GuardOptions } from '@casebook/model';
import type { CaseFacts, PersonView } from '@casebook/store';
import { momentOn, todayIso } from './conditions';

export class Samples {
	/** The value of each fact, by fact id; a fact that is absent counts as not recorded. */
	values = $state<Record<string, unknown>>({});
	/** The day `today()` reads, as YYYY-MM-DD, in the time zone conditions count days in. */
	asOf = $state('');
	/** The case the values were filled from, while they are unchanged. */
	from = $state<string | undefined>();
	/** The cases running the process, and the people a people fact can hold, once loaded. */
	context = $state<{ cases: CaseFacts[]; people: PersonView[] } | undefined>();
	/** Why the cases could not be loaded. */
	error = $state<string | undefined>();
	#loading: Promise<void> | undefined;

	constructor(
		private instance: string,
		private process: string,
		readonly timeZone: string
	) {
		this.asOf = todayIso(timeZone);
	}

	/** How conditions are evaluated with these values: as if today were `asOf`. */
	get options(): GuardOptions {
		return { now: momentOn(this.asOf, this.timeZone), timeZone: this.timeZone };
	}

	/** Loads the cases and people once. */
	load(): Promise<void> {
		this.#loading ??= fetch(
			`/i/${encodeURIComponent(this.instance)}/processes/edit/cases?p=${encodeURIComponent(this.process)}`
		)
			.then(async (response) => {
				if (!response.ok) throw new Error('The cases could not be loaded');
				this.context = await response.json();
			})
			.catch((error) => {
				this.error = error instanceof Error ? error.message : String(error);
				this.#loading = undefined;
			});
		return this.#loading;
	}

	/** A person's name, or the id when it is not someone in this instance. */
	nameOf(id: string): string {
		return this.context?.people.find((p) => p.id === id)?.name ?? id;
	}

	set(fact: string, value: unknown) {
		const next = { ...this.values };
		if (value === undefined) delete next[fact];
		else next[fact] = value;
		this.values = next;
		this.from = undefined;
	}

	fill(caseId: string) {
		const c = this.context?.cases.find((x) => x.id === caseId);
		if (!c) return;
		this.values = { ...c.facts };
		this.from = c.title;
	}
}

// Not reactive itself: each process's Samples is, and is made once on first use.
const all: Record<string, Samples> = {};

/**
 * The sample values for a process in an instance, counting days in the time zone the editor page
 * was given.
 */
export function samplesFor(instance: string, process: string, timeZone: string): Samples {
	return (all[`${instance}/${process}`] ??= new Samples(instance, process, timeZone));
}
