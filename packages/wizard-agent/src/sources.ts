/**
 * Source cells: every node the agent drafts links back to the cells it came from (ADR 0011). A
 * node's `source.ref` is written the way a spreadsheet writes a reference, with the sheet quoted
 * when its name needs it: `Tasks!A2:C9` or `'Birth reg'!B4`, several joined by commas.
 */
import type { SourceRef } from '@casebook/model';
import { columnLetters, type Workbook } from '@casebook/sheet-import';

/** A sheet and an A1 address or range in it. */
export interface CellRange {
	sheet: string;
	range: string;
}

interface Bounds {
	firstRow: number;
	firstCol: number;
	lastRow: number;
	lastCol: number;
}

const CELL = /^\$?([A-Z]{1,3})\$?([1-9][0-9]{0,6})$/;

function columnNumber(letters: string): number {
	let n = 0;
	for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
	return n;
}

/** Bounds of an A1 address or range, or undefined when it is not one. */
export function parseRange(range: string): Bounds | undefined {
	const parts = range.trim().toUpperCase().split(':');
	if (parts.length > 2) return undefined;
	const a = CELL.exec(parts[0]!);
	const b = CELL.exec(parts[1] ?? parts[0]!);
	if (!a || !b) return undefined;
	const [r1, c1, r2, c2] = [Number(a[2]), columnNumber(a[1]!), Number(b[2]), columnNumber(b[1]!)];
	return {
		firstRow: Math.min(r1, r2),
		firstCol: Math.min(c1, c2),
		lastRow: Math.max(r1, r2),
		lastCol: Math.max(c1, c2)
	};
}

const overlaps = (a: Bounds, b: Bounds) =>
	a.firstRow <= b.lastRow &&
	b.firstRow <= a.lastRow &&
	a.firstCol <= b.lastCol &&
	b.firstCol <= a.lastCol;

/**
 * Why a range does not point at content in the workbook, or undefined when it does: the sheet
 * must exist and the range must overlap the cells it holds.
 */
export function rangeProblem(workbook: Workbook, { sheet, range }: CellRange): string | undefined {
	const found = workbook.sheets.find((s) => s.name === sheet);
	if (!found) {
		const names = workbook.sheets.map((s) => `"${s.name}"`).join(', ');
		return `there is no sheet "${sheet}"; the sheets are ${names}`;
	}
	const bounds = parseRange(range);
	if (!bounds) return `"${range}" is not an A1 address or range, such as B4 or A2:F9`;
	const used = found.source && parseRange(found.source.ref);
	if (!used) return `sheet "${sheet}" is empty`;
	if (!overlaps(bounds, used)) {
		return `${range} is outside the cells "${sheet}" uses (${found.source!.ref})`;
	}
	return undefined;
}

/** Normalises a range to upper case without `$` signs: `$a$2:c9` becomes `A2:C9`. */
export function normalizeRange(range: string): string {
	const bounds = parseRange(range);
	if (!bounds) return range;
	const start = `${columnLetters(bounds.firstCol)}${bounds.firstRow}`;
	const end = `${columnLetters(bounds.lastCol)}${bounds.lastRow}`;
	return start === end ? start : `${start}:${end}`;
}

const PLAIN_SHEET = /^[A-Za-z_][A-Za-z0-9_.]*$/;

/** `Tasks!A2:C9`, or `'Birth reg'!A2:C9` when the sheet name needs quoting. */
export function formatRange({ sheet, range }: CellRange): string {
	const name = PLAIN_SHEET.test(sheet) ? sheet : `'${sheet.replaceAll("'", "''")}'`;
	return `${name}!${normalizeRange(range)}`;
}

/**
 * Reads references written by `formatRange`, joined by commas. Returns nothing unless the whole
 * text reads as references.
 */
export function parseRanges(ref: string): CellRange[] {
	const ranges: CellRange[] = [];
	const pattern = /\s*(?:'((?:[^']|'')+)'|([^!,']+))!([$A-Za-z0-9:]+)\s*(?:,|$)/y;
	while (pattern.lastIndex < ref.length) {
		const m = pattern.exec(ref);
		if (!m) return [];
		const sheet = m[1] !== undefined ? m[1].replaceAll("''", "'") : m[2]!.trim();
		ranges.push({ sheet, range: normalizeRange(m[3]!) });
	}
	return ranges;
}

/**
 * A range as an agent might write it, made plain: `{sheet: 'Tasks', range: 'Tasks!A2:C9'}` or
 * `{sheet: 'Tasks', range: "'Tasks'!$a$2:c9"}` both become `{sheet: 'Tasks', range: 'A2:C9'}`.
 */
export function plainRange({ sheet, range }: CellRange): CellRange {
	if (range.includes('!')) {
		const [only, ...more] = parseRanges(range);
		if (only && more.length === 0) return only;
	}
	return { sheet: sheet.trim(), range: normalizeRange(range) };
}

/**
 * A node's source as an agent might write it, completed: the document is always the uploaded
 * file, `inferred` defaults to false, and a bare address such as `A3:F3` is taken to be on
 * `sheet` when the process is drafted from that one sheet. Anything else is left for
 * `sourceProblem` to explain.
 */
export function completeSource(source: unknown, fileName: string, sheet?: string): unknown {
	if (typeof source !== 'object' || source === null || Array.isArray(source)) return source;
	const { ref, inferred } = source as { ref?: unknown; inferred?: unknown };
	let fixed = ref;
	if (typeof ref === 'string' && sheet && parseRanges(ref).length === 0 && parseRange(ref)) {
		fixed = formatRange({ sheet, range: ref });
	}
	return { ...source, doc: fileName, ref: fixed, inferred: inferred === true };
}

/** The model's source reference for cells of the uploaded file. */
export function sourceRef(fileName: string, ranges: CellRange[], inferred = false): SourceRef {
	return { doc: fileName, ref: ranges.map(formatRange).join(', '), inferred };
}

/** Rows a range spans: `A2:F23` spans 22. */
export function rowCount(range: string): number {
	const bounds = parseRange(range);
	return bounds ? bounds.lastRow - bounds.firstRow + 1 : 0;
}

/** `"Birth reg" A2:F23 · 22 rows`, for people. */
export function describeRange(r: CellRange): string {
	const rows = rowCount(r.range);
	return `"${r.sheet}" ${normalizeRange(r.range)} · ${rows} ${rows === 1 ? 'row' : 'rows'}`;
}

/**
 * Why a node's source does not link to cells of this workbook, or undefined when it does. The
 * document must be the uploaded file and every reference must point at content.
 */
export function sourceProblem(
	workbook: Workbook,
	fileName: string,
	source: unknown
): string | undefined {
	if (typeof source !== 'object' || source === null) {
		return `it has no core.source; set {"doc": "${fileName}", "ref": "<Sheet>!<cells>", "inferred": false} to the cells it comes from`;
	}
	const { doc, ref } = source as { doc?: unknown; ref?: unknown };
	if (doc !== fileName) return `core.source.doc must be "${fileName}"`;
	if (typeof ref !== 'string' || ref.trim() === '') {
		return 'core.source.ref must name the cells it comes from, such as Tasks!A2:C2';
	}
	const ranges = parseRanges(ref);
	if (ranges.length === 0) {
		return `core.source.ref "${ref}" is not a cell reference such as Tasks!A2:C2 or 'Birth reg'!B4`;
	}
	for (const range of ranges) {
		const problem = rangeProblem(workbook, range);
		if (problem) return `core.source.ref ${formatRange(range)}: ${problem}`;
	}
	return undefined;
}
