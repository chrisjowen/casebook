/**
 * What of the workbook the agent is shown up front. A small workbook goes in whole. A large one
 * would make every model call slow (minutes on a local model) and crowd out the conversation, so
 * the agent gets its tables with their headers and first rows instead, plus the cells of the
 * process being drafted, and reads only the other cells it needs with `read_cells`.
 */
import {
	rangeAddress,
	renderSheetText,
	renderWorkbookText,
	type Sheet,
	type Workbook
} from '@casebook/sheet-import';
import { formatRange, parseRange, type CellRange } from './sources.js';

/** Bound on the workbook text rendered whole. */
export const WORKBOOK_CHARS = 60_000;
/** A workbook whose text is at most this long is shown whole. */
export const INLINE_CHARS = 12_000;
/** Bound on the first rows of every table shown for a large workbook. */
const PREVIEW_CHARS = 8_000;
/** Bound on the cells of the process being drafted. */
const PROCESS_CHARS = 16_000;
/** Data rows shown under each table's header for a large workbook. */
const PREVIEW_ROWS = 3;
/** Tables listed in the overview, at most. */
const MAX_TABLES = 60;

/** The whole workbook as text, one line per row with every cell's address. */
export function workbookText(workbook: Workbook, fileName: string): string {
	const { text } = renderWorkbookText(workbook, { maxTotalChars: WORKBOOK_CHARS });
	return `# ${fileName}\n\n${text}`;
}

/**
 * One line per table in the workbook, with its cells and header, such as
 * `- "Claims" A2:F8: Step, Who, When (7 rows)`, so the split can be read off the tables.
 */
export function sheetOverview(workbook: Workbook): string {
	const lines: string[] = [];
	for (const sheet of workbook.sheets) {
		if (sheet.hidden || !sheet.source) continue;
		for (const region of sheet.regions) {
			const header = region.header;
			const range = header
				? rangeAddress(header.row, region.firstCol, region.lastRow, region.lastCol)
				: region.range;
			const labels = header ? `: ${Object.values(header.labels).join(', ')}` : '';
			const rows = region.lastRow - (header?.row ?? region.firstRow - 1);
			lines.push(`- "${sheet.name}" ${range}${labels} (${rows} rows)`);
		}
	}
	const more = lines.length - MAX_TABLES;
	return [...lines.slice(0, MAX_TABLES), ...(more > 0 ? [`- and ${more} more tables`] : [])].join(
		'\n'
	);
}

/** The cells of `ranges` as text, like the workbook's, within `maxChars`. */
export function rangesText(workbook: Workbook, ranges: CellRange[], maxChars: number): string {
	const parts: string[] = [];
	let left = maxChars;
	for (const range of ranges) {
		const sheet = workbook.sheets.find((s) => s.name === range.sheet);
		const bounds = parseRange(range.range);
		if (!sheet || !bounds || left < 200) continue;
		const inside = (row: number, col: number) =>
			row >= bounds.firstRow &&
			row <= bounds.lastRow &&
			col >= bounds.firstCol &&
			col <= bounds.lastCol;
		const part: Sheet = {
			...sheet,
			source: { sheet: sheet.name, ref: range.range },
			rows: sheet.rows
				.map((r) => ({ ...r, cells: r.cells.filter((c) => inside(c.row, c.col)) }))
				.filter((r) => r.cells.length > 0),
			regions: sheet.regions.filter(
				(r) =>
					r.firstRow <= bounds.lastRow &&
					bounds.firstRow <= r.lastRow &&
					r.firstCol <= bounds.lastCol &&
					bounds.firstCol <= r.lastCol
			),
			merges: []
		};
		const { text } = renderSheetText(part, { maxChars: left });
		parts.push(`${formatRange(range)}\n${text}`);
		left -= text.length;
	}
	return parts.join('\n\n');
}

/** Each table's header and first rows, for a large workbook. */
function tablePreviews(workbook: Workbook): string {
	const ranges: CellRange[] = [];
	for (const sheet of workbook.sheets) {
		if (sheet.hidden || !sheet.source) continue;
		for (const region of sheet.regions) {
			const top = region.header?.row ?? region.firstRow;
			const last = Math.min(region.lastRow, top + PREVIEW_ROWS);
			ranges.push({
				sheet: sheet.name,
				range: rangeAddress(region.firstRow, region.firstCol, last, region.lastCol)
			});
		}
	}
	return rangesText(workbook, ranges.slice(0, MAX_TABLES), PREVIEW_CHARS);
}

/**
 * The opening of the conversation about the workbook: the whole of it when small; otherwise its
 * tables with their first rows. With `process`, also the cells that process is drafted from.
 */
export function workbookOpening(
	workbook: Workbook,
	fileName: string,
	process?: { title: string; sources: CellRange[] }
): string {
	const whole = workbookText(workbook, fileName);
	const intro =
		whole.length <= INLINE_CHARS
			? `Here it is:\n\n${whole}`
			: `It is large, so here are its tables and their first rows. Read the other cells you need with read_cells, several ranges in one call.\n\nTables:\n${sheetOverview(workbook)}\n\nFirst rows:\n${tablePreviews(workbook)}`;
	if (!process || whole.length <= INLINE_CHARS) return intro;
	return `${intro}\n\nThe cells of ${process.title}, the process being drafted:\n${rangesText(workbook, process.sources, PROCESS_CHARS)}`;
}
