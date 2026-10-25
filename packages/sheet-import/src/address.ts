/** Converts a 1-based column number to letters: 1 -> `A`, 27 -> `AA`. */
export function columnLetters(col: number): string {
	let letters = '';
	let n = col;
	while (n > 0) {
		const rem = (n - 1) % 26;
		letters = String.fromCharCode(65 + rem) + letters;
		n = Math.floor((n - 1) / 26);
	}
	return letters;
}

/** A1 address from 1-based row and column numbers. */
export function cellAddress(row: number, col: number): string {
	return `${columnLetters(col)}${row}`;
}

/** A1 range from 1-based bounds; a single cell collapses to its address. */
export function rangeAddress(
	firstRow: number,
	firstCol: number,
	lastRow: number,
	lastCol: number
): string {
	const start = cellAddress(firstRow, firstCol);
	const end = cellAddress(lastRow, lastCol);
	return start === end ? start : `${start}:${end}`;
}
