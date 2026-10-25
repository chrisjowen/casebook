/** URL builders for the runner, so every page agrees on the route shapes. */
import { resolve } from '$app/paths';
import type { ResolvedPathname } from '$app/types';

/** `?a=1&b=2` for the parameters that have a value, or nothing. */
function search(params: Record<string, string | undefined>): '' | `?${string}` {
	const query = new URLSearchParams(
		Object.entries(params).filter((e): e is [string, string] => e[1] !== undefined && e[1] !== '')
	).toString();
	return query ? `?${query}` : '';
}

export const links = {
	myWork: (instance: string) => resolve('/i/[instance]', { instance }),
	cases: (instance: string) => resolve('/i/[instance]/cases', { instance }),
	newCase: (instance: string, opts: { case?: string; process?: string } = {}) =>
		resolve(`/i/[instance]/cases/new${search({ case: opts.case, process: opts.process })}`, {
			instance
		}),
	case: (instance: string, c: string) => resolve('/i/[instance]/c/[case]', { instance, case: c }),
	record: (instance: string, c: string) =>
		resolve('/i/[instance]/c/[case]/record', { instance, case: c }),
	wholeProcess: (instance: string, c: string, attachment: string) =>
		resolve('/i/[instance]/c/[case]/p/[attachment]', { instance, case: c, attachment }),
	task: (instance: string, c: string, attachment: string, item: string) =>
		resolve('/i/[instance]/c/[case]/t/[attachment]/[item]', {
			instance,
			case: c,
			attachment,
			item
		}),
	file: (id: string) => resolve('/files/[id]', { id }),
	processes: (instance: string) => resolve('/i/[instance]/processes', { instance }),
	process: (instance: string, slug: string) =>
		resolve('/i/[instance]/processes/[slug]', { instance, slug }),
	/** The board editor, inside Processes, opened on one definition's workspace. */
	editor: (instance: string, namespace?: string, slug?: string) =>
		resolve(`/i/[instance]/processes/edit${search({ ws: namespace, p: slug })}`, { instance }),
	requests: () => resolve('/requests'),
	request: (attachment: string, item: string) =>
		resolve('/requests/[attachment]/[item]', { attachment, item }),
	/** The current page with other query parameters, such as a filter. */
	here: (url: URL, params: Record<string, string | undefined>): ResolvedPathname => {
		const next = new URLSearchParams(url.searchParams);
		for (const [key, value] of Object.entries(params)) {
			if (value) next.set(key, value);
			else next.delete(key);
		}
		const query = next.toString();
		// The page's own pathname is already resolved.
		return `${url.pathname}${query ? `?${query}` : ''}` as ResolvedPathname;
	}
};
