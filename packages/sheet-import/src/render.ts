import { rangeAddress } from './address.js';
import type { Cell, Region, Row, Sheet, SourceRef, Workbook } from './types.js';

export interface RenderOptions {
	/** Budget for one sheet's text, in characters. Default 12000. */
	maxChars?: number;
	/** Longer cell text is clipped to this many characters. Default 200. */
	maxCellChars?: number;
	/** Cells past this many in one row are left out (wide timelines). Default 40. */
	maxCellsPerRow?: number;
}

export interface WorkbookRenderOptions extends RenderOptions {
	/** Budget for the whole workbook, in characters. Default 50000. */
	maxTotalChars?: number;
}

/** What a rendering left out. Absent when everything fit. */
export interface Truncation {
	rowsShown: number;
	rowsTotal: number;
	/** The rows that did not fit the budget, when any. */
	omittedRows?: SourceRef;
	/** Cells whose text was clipped to `maxCellChars`. */
	clippedCells: number;
	/** Cells left out of rows wider than `maxCellsPerRow`. */
	omittedCells: number;
	/** Sheet header lines (merges, regions) that did not fit the budget, when any. */
	omittedHeaderLines?: number;
}

export interface SheetRendering {
	sheet: string;
	text: string;
	truncation?: Truncation;
}

export interface WorkbookRendering {
	text: string;
	sheets: SheetRendering[];
	/** Sheets left out entirely because the workbook budget ran out. */
	omittedSheets: string[];
}

export const DEFAULT_MAX_CHARS = 12_000;
export const DEFAULT_MAX_CELL_CHARS = 200;
export const DEFAULT_MAX_CELLS_PER_ROW = 40;
export const DEFAULT_MAX_TOTAL_CHARS = 50_000;

/** Room kept back for the truncation line, so it always fits. */
const TRAILER_RESERVE = 240;
const MAX_REGION_LINES = 20;
const MAX_MERGES_LISTED = 30;
const MAX_LABELS_LISTED = 30;

/**
 * Renders one sheet as compact, addressed text for an LLM:
 *
 * ```
 * === Sheet "Tasks" · used A1:C3 · 3 rows
 * merged: A1:C1
 * region A1:C3 · header row 2: Task, Owner, Due
 * r1: A1 Newborn checklist [merged A1:C1]
 * r2: A2 Task | B2 Owner | C2 Due
 * r3: A3 Register birth | B3 Sam | C3 01/03/2024 [date 2024-03-01]
 * ```
 *
 * Cell text escapes `\`, `|` and newlines. When the budget runs out, the text
 * ends with a `[truncated: ...]` line and `truncation` says what was cut.
 */
export function renderSheetText(sheet: Sheet, options: RenderOptions = {}): SheetRendering {
	const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
	const maxCellChars = options.maxCellChars ?? DEFAULT_MAX_CELL_CHARS;
	const maxCellsPerRow = options.maxCellsPerRow ?? DEFAULT_MAX_CELLS_PER_ROW;

	const budget = Math.max(0, maxChars - TRAILER_RESERVE);
	const header = headerLines(sheet);
	const lines: string[] = [];
	let used = 0;
	for (const line of header) {
		if (used + line.length + 1 > budget) break;
		lines.push(line);
		used += line.length + 1;
	}
	const omittedHeaderLines = header.length - lines.length;

	let clippedCells = 0;
	let omittedCells = 0;
	let rowsShown = 0;
	for (const row of sheet.rows) {
		const rendered = renderRow(row, maxCellChars, maxCellsPerRow);
		if (used + rendered.line.length + 1 > budget) break;
		lines.push(rendered.line);
		used += rendered.line.length + 1;
		clippedCells += rendered.clipped;
		omittedCells += rendered.omitted;
		rowsShown++;
	}

	const rowsTotal = sheet.rows.length;
	const omitted = sheet.rows.slice(rowsShown);
	if (
		omitted.length === 0 &&
		clippedCells === 0 &&
		omittedCells === 0 &&
		omittedHeaderLines === 0
	) {
		return { sheet: sheet.name, text: lines.join('\n') };
	}

	const truncation: Truncation = { rowsShown, rowsTotal, clippedCells, omittedCells };
	const parts: string[] = [];
	if (omittedHeaderLines > 0) {
		truncation.omittedHeaderLines = omittedHeaderLines;
		parts.push(`${omittedHeaderLines} header lines omitted`);
	}
	if (omitted.length > 0) {
		const omittedRows = { sheet: sheet.name, ref: rowsRange(omitted) };
		truncation.omittedRows = omittedRows;
		parts.push(
			`showing ${rowsShown} of ${rowsTotal} rows; ${omitted.length} rows omitted (${omittedRows.ref})`
		);
	}
	if (clippedCells > 0) parts.push(`${clippedCells} cells clipped to ${maxCellChars} chars`);
	if (omittedCells > 0)
		parts.push(`${omittedCells} cells beyond ${maxCellsPerRow} per row omitted`);
	lines.push(`[truncated: ${parts.join('; ')}]`);
	return { sheet: sheet.name, text: lines.join('\n'), truncation };
}

/**
 * Renders every sheet in order, each within its own budget and all within the
 * workbook budget. Sheets that no longer fit are listed in `omittedSheets` and
 * named in a final `[omitted sheets: ...]` line.
 */
export function renderWorkbookText(
	workbook: Workbook,
	options: WorkbookRenderOptions = {}
): WorkbookRendering {
	const maxTotal = options.maxTotalChars ?? DEFAULT_MAX_TOTAL_CHARS;
	const perSheet = options.maxChars ?? DEFAULT_MAX_CHARS;
	const sheets: SheetRendering[] = [];
	const omittedSheets: string[] = [];
	let remaining = maxTotal - TRAILER_RESERVE;

	for (const sheet of workbook.sheets) {
		// Below this a sheet could show little more than its own truncation line.
		if (omittedSheets.length > 0 || remaining < TRAILER_RESERVE * 2) {
			omittedSheets.push(sheet.name);
			continue;
		}
		const rendering = renderSheetText(sheet, {
			...options,
			maxChars: Math.min(perSheet, remaining)
		});
		sheets.push(rendering);
		remaining -= rendering.text.length + 2;
	}

	const blocks = sheets.map((s) => s.text);
	if (omittedSheets.length > 0) blocks.push(omittedSheetsLine(omittedSheets));
	return { text: blocks.join('\n\n'), sheets, omittedSheets };
}

function omittedSheetsLine(names: string[]): string {
	const listed: string[] = [];
	let length = 0;
	for (const [i, name] of names.entries()) {
		const quoted = JSON.stringify(name);
		const more = i + 1 < names.length ? ` +${names.length - i - 1} more`.length : 0;
		if (length + quoted.length + 2 + more > TRAILER_RESERVE - 40) {
			listed.push(`+${names.length - i} more`);
			break;
		}
		listed.push(quoted);
		length += quoted.length + 2;
	}
	return `[omitted sheets: ${listed.join(', ')}]`;
}

function headerLines(sheet: Sheet): string[] {
	const facts = [`=== Sheet ${JSON.stringify(sheet.name)}`];
	if (sheet.hidden) facts.push('hidden');
	if (!sheet.source) {
		facts.push('empty');
		return [facts.join(' · ')];
	}
	facts.push(`used ${sheet.source.ref}`, `${sheet.rows.length} rows`);
	if (sheet.declaredRange && sheet.declaredRange !== sheet.source.ref) {
		facts.push(`declared ${sheet.declaredRange}`);
	}
	if (sheet.limits) {
		facts.push(
			`${sheet.limits.droppedCells} cells beyond ${sheet.limits.maxRows} rows x ${sheet.limits.maxCols} cols not read`
		);
	}

	const lines = [facts.join(' · ')];
	if (sheet.merges.length > 0) {
		const listed = sheet.merges.slice(0, MAX_MERGES_LISTED).map((m) => m.range);
		if (sheet.merges.length > MAX_MERGES_LISTED)
			listed.push(`+${sheet.merges.length - MAX_MERGES_LISTED} more`);
		lines.push(`merged: ${listed.join(', ')}`);
	}
	if (sheet.regions.length > 1 || sheet.regions[0]?.header) {
		for (const region of sheet.regions.slice(0, MAX_REGION_LINES)) lines.push(regionLine(region));
		if (sheet.regions.length > MAX_REGION_LINES) {
			lines.push(`... ${sheet.regions.length - MAX_REGION_LINES} more regions`);
		}
	}
	return lines;
}

function regionLine(region: Region): string {
	const parts = [`region ${region.range}`];
	if (region.header) {
		const all = Object.values(region.header.labels);
		const labels = all.slice(0, MAX_LABELS_LISTED).map((l) => clip(escape(l), 40).text);
		if (all.length > MAX_LABELS_LISTED) labels.push(`+${all.length - MAX_LABELS_LISTED} more`);
		parts.push(`header row ${region.header.row}: ${labels.join(', ')}`);
	}
	if (region.rowLabelColumn) parts.push(`row labels in ${region.rowLabelColumn}`);
	return parts.join(' · ');
}

function renderRow(
	row: Row,
	maxCellChars: number,
	maxCellsPerRow: number
): { line: string; clipped: number; omitted: number } {
	const shown = row.cells.slice(0, maxCellsPerRow);
	const rest = row.cells.slice(maxCellsPerRow);
	let clipped = 0;
	const parts = shown.map((cell) => {
		const rendered = renderCell(cell, maxCellChars);
		if (rendered.clipped) clipped++;
		return rendered.text;
	});
	if (rest.length > 0) {
		const last = rest[rest.length - 1]!;
		parts.push(`... +${rest.length} cells to ${last.address}`);
	}
	return { line: `r${row.row}: ${parts.join(' | ')}`, clipped, omitted: rest.length };
}

function renderCell(cell: Cell, maxCellChars: number): { text: string; clipped: boolean } {
	const value = clip(escape(cell.text), maxCellChars);
	const notes: string[] = [];
	if (cell.formula) notes.push(`=${escape(cell.formula)}`);
	if (cell.value.type === 'date' && cell.value.value !== cell.text)
		notes.push(`date ${cell.value.value}`);
	if (cell.merge) notes.push(`merged ${cell.merge}`);
	if (cell.hyperlink) notes.push(`link ${escape(cell.hyperlink.target)}`);
	for (const comment of cell.comments ?? []) {
		const author = comment.author ? ` ${escape(comment.author)}` : '';
		notes.push(`note${author}: ${clip(escape(comment.text), maxCellChars).text}`);
	}
	const suffix = notes.map((n) => ` [${n}]`).join('');
	return { text: `${cell.address} ${value.text}${suffix}`, clipped: value.clipped };
}

function escape(text: string): string {
	return text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, '\\n');
}

function clip(text: string, max: number): { text: string; clipped: boolean } {
	if (text.length <= max) return { text, clipped: false };
	return { text: `${text.slice(0, max)}...(+${text.length - max} chars)`, clipped: true };
}

function rowsRange(rows: Row[]): string {
	let firstCol = Infinity;
	let lastCol = -Infinity;
	for (const r of rows) {
		firstCol = Math.min(firstCol, r.cells[0]!.col);
		lastCol = Math.max(lastCol, r.cells[r.cells.length - 1]!.col);
	}
	return rangeAddress(rows[0]!.row, firstCol, rows[rows.length - 1]!.row, lastCol);
}
