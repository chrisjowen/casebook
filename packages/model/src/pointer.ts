/** A location in a document, as JSON Pointer segments. */
export type Segments = readonly (string | number)[];

export function toPointer(segments: Segments): string {
	return segments.map((s) => `/${String(s).replaceAll('~', '~0').replaceAll('/', '~1')}`).join('');
}

/** Formats segments as a readable field path, such as `core.collects[0].fact` or `data["ui.icon"]`. */
export function formatField(segments: Segments): string {
	return segments
		.map((s, i) => {
			if (typeof s === 'number' || /^\d+$/.test(s)) return `[${s}]`;
			if (/^[A-Za-z_$][\w$]*$/.test(s)) return i === 0 ? s : `.${s}`;
			return `[${JSON.stringify(s)}]`;
		})
		.join('');
}
