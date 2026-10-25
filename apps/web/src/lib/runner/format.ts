// Dates and times as the runner shows them. Times are shown in UTC, like the recorded values.
const MONTHS = [
	'Jan',
	'Feb',
	'Mar',
	'Apr',
	'May',
	'Jun',
	'Jul',
	'Aug',
	'Sept',
	'Oct',
	'Nov',
	'Dec'
];

/** "20 Sept", or "20 Sept 2025" outside the current year, or always with the year when asked. */
export function day(iso: string, withYear = false, now = new Date()): string {
	const d = new Date(iso);
	const year = withYear || d.getUTCFullYear() !== now.getUTCFullYear();
	return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${year ? ` ${d.getUTCFullYear()}` : ''}`;
}

/** "25 Oct, 06:30". */
export function when(iso: string, now = new Date()): string {
	const d = new Date(iso);
	const hh = String(d.getUTCHours()).padStart(2, '0');
	const mm = String(d.getUTCMinutes()).padStart(2, '0');
	return `${day(iso, false, now)}, ${hh}:${mm}`;
}

/** "in 12 min", "4 min ago", "2 days ago". */
export function relative(iso: string, now = new Date()): string {
	const diff = new Date(iso).getTime() - now.getTime();
	const mins = Math.round(Math.abs(diff) / 60_000);
	if (mins === 0) return 'now';
	const days = Math.round(mins / 60 / 24);
	const text =
		mins < 60
			? `${mins} min`
			: mins < 60 * 24
				? `${Math.round(mins / 60)} h`
				: `${days} ${days === 1 ? 'day' : 'days'}`;
	return diff >= 0 ? `in ${text}` : `${text} ago`;
}

/** "Alex Example", "Alex Example or Sam Example", or a fallback when nobody holds the role. */
export function names(people: { name: string }[], nobody = 'nobody yet'): string {
	const list = people.map((p) => p.name);
	if (list.length === 0) return nobody;
	if (list.length === 1) return list[0]!;
	return `${list.slice(0, -1).join(', ')} or ${list.at(-1)}`;
}

export const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/**
 * A condition as one line. One built from rules already reads "Only when Estimated cost is more
 * than 2000"; prose, such as "Always for SEV1 and SEV2", follows "When:".
 */
export function onlyWhen(text: string): string {
	return /^only when\s/i.test(text) ? `Only when ${text.slice(10)}` : `When: ${lowerFirst(text)}`;
}

/** "1.2 MB", "96 KB". */
export function size(bytes: number): string {
	if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
	return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
