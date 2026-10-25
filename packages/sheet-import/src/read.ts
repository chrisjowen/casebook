import * as XLSX from 'xlsx';
import { cellAddress, rangeAddress } from './address.js';
import { detectRegions } from './regions.js';
import type {
	Cell,
	CellComment,
	CellHyperlink,
	CellValue,
	MergedRange,
	Row,
	Sheet,
	SheetLimits,
	Workbook
} from './types.js';

export interface ReadOptions {
	/** Rows beyond this (counted from row 1) are dropped and reported in `Sheet.limits`. Default 10000. */
	maxRows?: number;
	/** Columns beyond this (counted from column A) are dropped and reported in `Sheet.limits`. Default 500. */
	maxCols?: number;
}

export const DEFAULT_MAX_ROWS = 10_000;
export const DEFAULT_MAX_COLS = 500;

/** Thrown when the input is not a workbook this package can read. */
export class SheetImportError extends Error {
	override name = 'SheetImportError';
}

/**
 * Reads an .xlsx workbook into the neutral model. Pure: takes bytes, does no I/O.
 */
export function readWorkbook(data: Uint8Array | ArrayBuffer, options: ReadOptions = {}): Workbook {
	const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
	// .xlsx is a zip container; without this check SheetJS would happily parse
	// arbitrary bytes as CSV.
	if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
		throw new SheetImportError('Not an .xlsx workbook: expected a zip container');
	}

	let book: XLSX.WorkBook;
	try {
		book = XLSX.read(bytes, {
			type: 'array',
			dense: true,
			cellFormula: true,
			cellNF: true,
			cellText: true,
			cellDates: false
		});
	} catch (error) {
		throw new SheetImportError(`Could not read workbook: ${(error as Error).message}`, {
			cause: error
		});
	}

	const date1904 = book.Workbook?.WBProps?.date1904 === true;
	const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;
	const maxCols = options.maxCols ?? DEFAULT_MAX_COLS;

	const sheets = book.SheetNames.map((name, index) => {
		const ws = book.Sheets[name];
		const hidden = (book.Workbook?.Sheets?.[index]?.Hidden ?? 0) !== 0;
		return readSheet(name, index, hidden, ws, { date1904, maxRows, maxCols });
	});

	return { sheets, date1904 };
}

interface SheetContext {
	date1904: boolean;
	maxRows: number;
	maxCols: number;
}

function readSheet(
	name: string,
	index: number,
	hidden: boolean,
	ws: XLSX.WorkSheet | undefined,
	ctx: SheetContext
): Sheet {
	const declaredRange = ws?.['!ref'] ?? null;
	const data = ws?.['!data'] ?? [];

	const cells: Cell[] = [];
	let droppedCells = 0;
	// forEach skips the holes of the sparse dense-mode arrays, so a declared
	// dimension running to row 1,048,576 costs nothing when those rows are empty.
	data.forEach((rowData, r) => {
		rowData?.forEach((raw, c) => {
			if (!raw) return;
			const cell = toCell(name, r + 1, c + 1, raw, ctx.date1904);
			if (!cell) return;
			if (cell.row > ctx.maxRows || cell.col > ctx.maxCols) {
				droppedCells++;
				return;
			}
			cells.push(cell);
		});
	});

	const byAddress = new Map(cells.map((cell) => [cell.address, cell]));
	const merges: MergedRange[] = [];
	for (const m of ws?.['!merges'] ?? []) {
		// A merge only matters when its top-left cell holds something; merges
		// over empty cells are formatting.
		const anchor = byAddress.get(cellAddress(m.s.r + 1, m.s.c + 1));
		if (!anchor) continue;
		const range = rangeAddress(
			m.s.r + 1,
			m.s.c + 1,
			Math.min(m.e.r + 1, ctx.maxRows),
			Math.min(m.e.c + 1, ctx.maxCols)
		);
		anchor.merge = range;
		merges.push({ source: { sheet: name, ref: range }, range });
	}

	const rows = groupRows(name, cells);
	const regions = detectRegions(name, rows, merges);

	let source: Sheet['source'] = null;
	if (regions.length > 0) {
		const firstRow = Math.min(...regions.map((r) => r.firstRow));
		const firstCol = Math.min(...regions.map((r) => r.firstCol));
		const lastRow = Math.max(...regions.map((r) => r.lastRow));
		const lastCol = Math.max(...regions.map((r) => r.lastCol));
		source = { sheet: name, ref: rangeAddress(firstRow, firstCol, lastRow, lastCol) };
	}

	const sheet: Sheet = { name, index, hidden, source, declaredRange, rows, merges, regions };
	if (droppedCells > 0) {
		const limits: SheetLimits = { droppedCells, maxRows: ctx.maxRows, maxCols: ctx.maxCols };
		sheet.limits = limits;
	}
	return sheet;
}

function groupRows(sheet: string, cells: Cell[]): Row[] {
	const byRow = new Map<number, Cell[]>();
	for (const cell of cells) {
		const list = byRow.get(cell.row);
		if (list) list.push(cell);
		else byRow.set(cell.row, [cell]);
	}
	return [...byRow.entries()]
		.sort(([a], [b]) => a - b)
		.map(([row, rowCells]) => {
			rowCells.sort((a, b) => a.col - b.col);
			const first = rowCells[0]!;
			const last = rowCells[rowCells.length - 1]!;
			return {
				source: { sheet, ref: rangeAddress(row, first.col, row, last.col) },
				row,
				cells: rowCells
			};
		});
}

/** Returns `undefined` for cells with nothing worth keeping. */
function toCell(
	sheet: string,
	row: number,
	col: number,
	raw: XLSX.CellObject,
	date1904: boolean
): Cell | undefined {
	const address = cellAddress(row, col);
	const comments = toComments(raw.c);
	const hyperlink = toHyperlink(raw.l);
	const numberFormat = typeof raw.z === 'string' && raw.z !== 'General' ? raw.z : undefined;

	let value: CellValue;
	let rawValue: Cell['raw'];
	let text: string;
	switch (raw.t) {
		case 's': {
			const s = normalizeText(String(raw.v ?? ''));
			value = s.trim() === '' ? { type: 'empty' } : { type: 'string', value: s };
			rawValue = s;
			text = normalizeText(raw.w ?? s);
			break;
		}
		case 'n': {
			if (typeof raw.v !== 'number') {
				value = { type: 'empty' };
				rawValue = null;
				text = '';
				break;
			}
			rawValue = raw.v;
			value =
				numberFormat && XLSX.SSF.is_date(numberFormat)
					? { type: 'date', value: serialToIso(raw.v, numberFormat, date1904) }
					: { type: 'number', value: raw.v };
			text = raw.w ?? String(raw.v);
			break;
		}
		case 'b':
			rawValue = Boolean(raw.v);
			value = { type: 'boolean', value: rawValue };
			text = raw.w ?? (rawValue ? 'TRUE' : 'FALSE');
			break;
		case 'e': {
			const code = raw.w ?? '#ERROR!';
			rawValue = code;
			value = { type: 'error', value: code };
			text = code;
			break;
		}
		case 'd': {
			// Only produced for files that store ISO dates directly; SheetJS builds
			// these Date objects in UTC.
			const d = raw.v instanceof Date ? raw.v : new Date(String(raw.v));
			const iso = d
				.toISOString()
				.replace(/\.\d{3}Z$/, '')
				.replace(/T00:00:00$/, '');
			rawValue = iso;
			value = { type: 'date', value: iso };
			text = raw.w ?? iso;
			break;
		}
		default:
			value = { type: 'empty' };
			rawValue = null;
			text = '';
	}

	// Formulas whose cached result is empty are dropped too: sheets often carry
	// them pre-filled far below the real data, and they display nothing.
	if (value.type === 'empty' && !comments && !hyperlink) return undefined;

	const cell: Cell = {
		source: { sheet, ref: address },
		address,
		row,
		col,
		raw: rawValue,
		value,
		text
	};
	if (raw.f) cell.formula = raw.f;
	if (numberFormat) cell.numberFormat = numberFormat;
	if (hyperlink) cell.hyperlink = hyperlink;
	if (comments) cell.comments = comments;
	return cell;
}

function normalizeText(s: string): string {
	return s.replace(/\r\n?/g, '\n');
}

function toComments(comments: XLSX.Comments | undefined): CellComment[] | undefined {
	if (!comments || comments.length === 0) return undefined;
	return comments.map((c) => {
		const comment: CellComment = { text: normalizeText(c.t ?? '') };
		if (c.a) comment.author = c.a;
		return comment;
	});
}

function toHyperlink(link: XLSX.Hyperlink | undefined): CellHyperlink | undefined {
	if (!link?.Target) return undefined;
	const hyperlink: CellHyperlink = { target: link.Target };
	if (link.Tooltip) hyperlink.tooltip = link.Tooltip;
	return hyperlink;
}

interface DateCode {
	y: number;
	m: number;
	d: number;
	H: number;
	M: number;
	S: number;
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/**
 * Serial day number to a zone-less ISO string. Time-only formats (`hh:mm`) give
 * `HH:MM:SS`; otherwise whole days give `YYYY-MM-DD` and the rest both.
 */
function serialToIso(serial: number, format: string, date1904: boolean): string {
	const code = XLSX.SSF.parse_date_code(serial, { date1904 }) as DateCode;
	const time = `${pad(code.H)}:${pad(code.M)}:${pad(code.S)}`;
	// Ignore quoted literals and [bracketed] parts such as colours and locales.
	const tokens = format.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, '');
	if (!/[yd]/i.test(tokens)) return time;
	const date = `${pad(code.y, 4)}-${pad(code.m)}-${pad(code.d)}`;
	return code.H === 0 && code.M === 0 && code.S === 0 ? date : `${date}T${time}`;
}
