// Recorded values in words, as people read them on a case: names for principals, amounts with
// their currency, dates written out, and files by name.
import { referencedFile, type FactNode } from '@casebook/model';
import type { FileRecord, Person } from './load.js';

const DATE = new Intl.DateTimeFormat('en-GB', {
	day: 'numeric',
	month: 'short',
	year: 'numeric',
	timeZone: 'UTC'
});
const DATE_TIME = new Intl.DateTimeFormat('en-GB', {
	day: 'numeric',
	month: 'short',
	year: 'numeric',
	hour: '2-digit',
	minute: '2-digit',
	timeZone: 'UTC',
	timeZoneName: 'short'
});

/** A recorded value in words. */
export function displayValue(
	fact: FactNode | undefined,
	value: unknown,
	people: ReadonlyMap<string, Person>,
	files: readonly FileRecord[]
): string {
	const schema = fact?.core.schema ?? {};
	const one = (v: unknown, itemSchema = schema): string => {
		const fileId = referencedFile(v);
		if (fileId) return files.find((f) => f.id === fileId)?.name ?? 'a file';
		if (schema['x-lookup']?.kind === 'principal' && typeof v === 'string') {
			return people.get(v)?.name ?? 'someone';
		}
		if (typeof v === 'boolean') return v ? 'Yes' : 'No';
		if (typeof v === 'number') {
			const currency = schema['x-currency'];
			return typeof currency === 'string'
				? v.toLocaleString('en-GB', { style: 'currency', currency, maximumFractionDigits: 2 })
				: v.toLocaleString('en-GB');
		}
		if (typeof v === 'string') {
			if (itemSchema.format === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
				return DATE.format(new Date(`${v}T00:00:00Z`));
			}
			if (itemSchema.format === 'date-time' && !Number.isNaN(Date.parse(v))) {
				return DATE_TIME.format(new Date(v));
			}
			return v;
		}
		if (v === null || v === undefined) return '—';
		return JSON.stringify(v);
	};
	if (Array.isArray(value)) {
		const items = (schema.items ?? {}) as typeof schema;
		return value.map((v) => one(v, items)).join(', ');
	}
	return one(value);
}
