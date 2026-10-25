import * as XLSX from 'xlsx';

/**
 * Synthetic workbooks built in memory (ADR 0014: never real personal data).
 * Each sheet is written to real .xlsx bytes and read back, so tests go through
 * the same parser path as an upload.
 */

export type FixtureCell = string | number | boolean | null | XLSX.CellObject;

export interface FixtureSheet {
	name: string;
	/** Rows of cells from A1; `null` leaves a cell empty. */
	rows?: FixtureCell[][];
	/** Extra cells by A1 address, applied after `rows`. */
	cells?: Record<string, XLSX.CellObject>;
	merges?: string[];
	/** Overrides the declared dimension, to mimic files with long empty trailing ranges. */
	declaredRange?: string;
	hidden?: boolean;
}

export function buildWorkbook(
	sheets: FixtureSheet[],
	options: { date1904?: boolean } = {}
): Uint8Array {
	const wb = XLSX.utils.book_new();
	for (const spec of sheets) {
		const ws = XLSX.utils.aoa_to_sheet(spec.rows ?? [[]]);
		for (const [address, cell] of Object.entries(spec.cells ?? {})) ws[address] = cell;
		if (spec.merges) ws['!merges'] = spec.merges.map((m) => XLSX.utils.decode_range(m));
		ws['!ref'] = spec.declaredRange ?? extent(ws);
		XLSX.utils.book_append_sheet(wb, ws, spec.name);
	}
	wb.Workbook ??= {};
	wb.Workbook.Sheets = sheets.map((s) => ({ name: s.name, Hidden: s.hidden ? 1 : 0 }));
	if (options.date1904) wb.Workbook.WBProps = { date1904: true };
	return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}

function extent(ws: XLSX.WorkSheet): string {
	const addresses = Object.keys(ws).filter((k) => !k.startsWith('!'));
	if (addresses.length === 0) return 'A1';
	const cells = addresses.map((a) => XLSX.utils.decode_cell(a));
	return XLSX.utils.encode_range({
		s: { r: Math.min(...cells.map((c) => c.r)), c: Math.min(...cells.map((c) => c.c)) },
		e: { r: Math.max(...cells.map((c) => c.r)), c: Math.max(...cells.map((c) => c.c)) }
	});
}

/** A date-formatted serial cell. */
export const dateCell = (serial: number, z = 'yyyy-mm-dd'): XLSX.CellObject => ({
	t: 'n',
	v: serial,
	z
});

/** A formula cell with a cached result, as Excel saves it. */
export const formulaCell = (f: string, v: string | number | boolean): XLSX.CellObject => ({
	t: typeof v === 'number' ? 'n' : typeof v === 'boolean' ? 'b' : 's',
	v,
	f
});
