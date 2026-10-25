import { columnLetters, rangeAddress } from './address.js';
import type { Cell, HeaderHint, HeaderReason, MergedRange, Region, Row } from './types.js';

interface Box {
	firstRow: number;
	lastRow: number;
	firstCol: number;
	lastCol: number;
}

/**
 * Splits a sheet into rectangular blocks of content. Rows are first grouped into
 * bands separated by fully blank rows; each band is then split at fully blank
 * columns, so side-by-side tables also come apart. Merged ranges count as
 * occupied, so a title merged across a table stays attached to it.
 */
export function detectRegions(sheet: string, rows: Row[], merges: MergedRange[]): Region[] {
	const boxes: Box[] = rows.flatMap((row) =>
		row.cells.map((c) => ({ firstRow: c.row, lastRow: c.row, firstCol: c.col, lastCol: c.col }))
	);
	for (const m of merges) boxes.push(parseRange(m.range));
	if (boxes.length === 0) return [];

	const cellsByRow = new Map(rows.map((r) => [r.row, r.cells]));
	const regions: Region[] = [];
	for (const band of splitBy(boxes, 'firstRow', 'lastRow')) {
		for (const block of splitBy(band, 'firstCol', 'lastCol')) {
			regions.push(buildRegion(sheet, block, cellsByRow));
		}
	}
	return regions.sort((a, b) => a.firstRow - b.firstRow || a.firstCol - b.firstCol);
}

/** Groups boxes whose spans along one axis touch or overlap, with no gap between them. */
function splitBy(
	boxes: Box[],
	start: 'firstRow' | 'firstCol',
	end: 'lastRow' | 'lastCol'
): Box[][] {
	const sorted = [...boxes].sort((a, b) => a[start] - b[start]);
	const groups: Box[][] = [];
	let current: Box[] = [];
	let reach = -Infinity;
	for (const box of sorted) {
		if (current.length > 0 && box[start] > reach + 1) {
			groups.push(current);
			current = [];
			reach = -Infinity;
		}
		current.push(box);
		reach = Math.max(reach, box[end]);
	}
	if (current.length > 0) groups.push(current);
	return groups;
}

function buildRegion(sheet: string, boxes: Box[], cellsByRow: Map<number, Cell[]>): Region {
	// Loops rather than Math.min(...spread): a block can hold more cells than
	// the engine allows as call arguments.
	let firstRow = Infinity;
	let lastRow = -Infinity;
	let firstCol = Infinity;
	let lastCol = -Infinity;
	for (const b of boxes) {
		firstRow = Math.min(firstRow, b.firstRow);
		lastRow = Math.max(lastRow, b.lastRow);
		firstCol = Math.min(firstCol, b.firstCol);
		lastCol = Math.max(lastCol, b.lastCol);
	}
	const range = rangeAddress(firstRow, firstCol, lastRow, lastCol);

	const regionRows: { row: number; cells: Cell[] }[] = [];
	for (let r = firstRow; r <= lastRow; r++) {
		const cells = (cellsByRow.get(r) ?? []).filter((c) => c.col >= firstCol && c.col <= lastCol);
		if (cells.length > 0) regionRows.push({ row: r, cells });
	}

	const region: Region = {
		source: { sheet, ref: range },
		range,
		firstRow,
		lastRow,
		firstCol,
		lastCol,
		rowCount: regionRows.length
	};

	const header = detectHeader(sheet, regionRows, firstCol, lastCol);
	if (header) {
		region.header = header;
		const labelColumn = detectRowLabelColumn(regionRows, header.row, firstCol);
		if (labelColumn) region.rowLabelColumn = labelColumn;
	}
	return region;
}

const isText = (c: Cell) => c.value.type === 'string' && c.formula === undefined;

/**
 * Looks at the first row of the region, or the second when the first is a lone
 * title cell, and calls it a header when it is two or more distinct text cells
 * with more rows below.
 */
function detectHeader(
	sheet: string,
	rows: { row: number; cells: Cell[] }[],
	firstCol: number,
	lastCol: number
): HeaderHint | undefined {
	const first = rows[0];
	if (!first) return undefined;
	const titled = first.cells.length === 1 && rows.length > 2;
	const index = titled ? 1 : 0;
	const candidate = rows[index];
	const below = rows.slice(index + 1);
	if (!candidate || below.length === 0) return undefined;

	const cells = candidate.cells;
	if (cells.length < 2 || !cells.every(isText)) return undefined;
	const texts = cells.map((c) => c.text.trim());
	if (new Set(texts).size !== texts.length) return undefined;

	const reasons: HeaderReason[] = ['all-text', 'distinct-values'];
	const width = lastCol - firstCol + 1;
	if (cells.length * 2 >= width) reasons.push('spans-region');
	if (below.some((r) => r.cells.some((c) => !isText(c)))) reasons.push('followed-by-data');
	if (titled) reasons.push('below-title');

	const labels: Record<string, string> = {};
	for (const c of cells) labels[columnLetters(c.col)] = c.text.trim();
	const last = cells[cells.length - 1]!;
	return {
		source: { sheet, ref: rangeAddress(candidate.row, cells[0]!.col, candidate.row, last.col) },
		row: candidate.row,
		labels,
		reasons
	};
}

/** The region's first column, when every row below the header labels itself there with text. */
function detectRowLabelColumn(
	rows: { row: number; cells: Cell[] }[],
	headerRow: number,
	firstCol: number
): string | undefined {
	const body = rows.filter((r) => r.row > headerRow);
	if (body.length < 2) return undefined;
	const allLabelled = body.every((r) => {
		const first = r.cells[0];
		return first !== undefined && first.col === firstCol && isText(first) && r.cells.length > 1;
	});
	return allLabelled ? columnLetters(firstCol) : undefined;
}

function parseRange(range: string): Box {
	const [start, end = start] = range.split(':') as [string, string?];
	const a = parseAddress(start);
	const b = parseAddress(end);
	return { firstRow: a.row, lastRow: b.row, firstCol: a.col, lastCol: b.col };
}

function parseAddress(address: string): { row: number; col: number } {
	const match = /^([A-Z]+)(\d+)$/.exec(address);
	if (!match) throw new Error(`Bad A1 address: ${address}`);
	let col = 0;
	for (const ch of match[1]!) col = col * 26 + (ch.charCodeAt(0) - 64);
	return { row: Number(match[2]), col };
}
