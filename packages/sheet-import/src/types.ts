/**
 * The neutral workbook model. Everything here is plain JSON-serializable data:
 * no Date objects, no class instances, no parser types.
 */

/**
 * Points back at the source spreadsheet: a sheet name plus an A1 address
 * (`B4`) or an A1 range (`A1:F12`). Drafts store these to link nodes to cells.
 */
export interface SourceRef {
	sheet: string;
	ref: string;
}

/**
 * A cell's value with its type made explicit.
 *
 * Dates are ISO 8601 strings without a time zone (`2024-03-01` or
 * `2024-03-01T09:30:00`), because spreadsheet dates are wall-clock values.
 * For formula cells this is the result cached in the file; see `Cell.formula`.
 */
export type CellValue =
	| { type: 'string'; value: string }
	| { type: 'number'; value: number }
	| { type: 'boolean'; value: boolean }
	| { type: 'date'; value: string }
	| { type: 'error'; value: string }
	| { type: 'empty' };

export interface CellComment {
	author?: string;
	text: string;
}

export interface CellHyperlink {
	target: string;
	tooltip?: string;
}

export interface Cell {
	source: SourceRef;
	/** A1 address, for example `C7`. */
	address: string;
	/** 1-based row number, as shown in the spreadsheet. */
	row: number;
	/** 1-based column number (`A` is 1). */
	col: number;
	/**
	 * The value as stored in the file. Dates are stored as serial day numbers;
	 * errors as their display code (`#DIV/0!`).
	 */
	raw: string | number | boolean | null;
	value: CellValue;
	/** The text the spreadsheet shows, after number formatting. */
	text: string;
	/** Formula without the leading `=`, when the cell holds one. */
	formula?: string;
	numberFormat?: string;
	hyperlink?: CellHyperlink;
	comments?: CellComment[];
	/** Set on the top-left cell of a merged range: the whole range, for example `A1:D1`. */
	merge?: string;
}

export interface Row {
	source: SourceRef;
	/** 1-based row number. */
	row: number;
	/** Non-empty cells only, left to right. */
	cells: Cell[];
}

export interface MergedRange {
	source: SourceRef;
	/** A1 range, for example `A1:D1`. */
	range: string;
}

/**
 * Why a row looks like a header. Hints only: the wizard decides.
 */
export type HeaderReason =
	'all-text' | 'distinct-values' | 'spans-region' | 'followed-by-data' | 'below-title';

export interface HeaderHint {
	source: SourceRef;
	/** 1-based row number of the likely header row. */
	row: number;
	/** Column labels by A1 column letter, for example `{ A: 'Task', B: 'Owner' }`. */
	labels: Record<string, string>;
	reasons: HeaderReason[];
}

/**
 * A rectangular block of content separated from other blocks by blank rows or
 * blank columns. Several unrelated tables on one sheet become several regions.
 */
export interface Region {
	source: SourceRef;
	/** A1 range covering the block. */
	range: string;
	firstRow: number;
	lastRow: number;
	firstCol: number;
	lastCol: number;
	/** Rows inside the region that have content. */
	rowCount: number;
	header?: HeaderHint;
	/**
	 * Set when every row below the header starts with text in the first column,
	 * which then labels the rows (the items of an items-by-applications matrix,
	 * or the task names of a checklist): that column's letter.
	 */
	rowLabelColumn?: string;
}

export interface SheetLimits {
	/** Cells beyond `maxRows` or `maxCols` that were dropped while reading. */
	droppedCells: number;
	maxRows: number;
	maxCols: number;
}

export interface Sheet {
	name: string;
	/** 0-based position in the workbook. */
	index: number;
	hidden: boolean;
	/**
	 * The range that actually holds content (values, comments, hyperlinks and
	 * merged ranges), or `null` for an empty sheet. Formatted but empty cells,
	 * which make the file's declared dimension much larger, are ignored.
	 */
	source: SourceRef | null;
	/** The dimension the file declares, which may include long empty trailing ranges. */
	declaredRange: string | null;
	rows: Row[];
	merges: MergedRange[];
	regions: Region[];
	/** Present when content was dropped because the sheet exceeded the read limits. */
	limits?: SheetLimits;
}

export interface Workbook {
	sheets: Sheet[];
	/** True when dates are counted from 1904 rather than 1900. */
	date1904: boolean;
}
