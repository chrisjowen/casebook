import { describe, expect, it } from 'vitest';
import { readWorkbook, renderSheetText, renderWorkbookText } from '../src/index.js';
import { buildWorkbook, dateCell, formulaCell } from './fixtures.js';

describe('renderSheetText', () => {
	it('renders addressed rows with regions, merges and cell annotations', () => {
		const wb = readWorkbook(
			buildWorkbook([
				{
					name: 'Tasks',
					rows: [
						['Newborn checklist'],
						['Task', 'Owner', 'Due'],
						['Register birth', 'Sam | Alex', dateCell(45352, 'dd/mm/yyyy')],
						['Total', formulaCell('COUNTA(A3:A3)', 1), null]
					],
					cells: {
						A5: { t: 's', v: 'Line one\nLine two', c: [{ a: 'Alex', t: 'Ask GP' }] },
						B5: { t: 's', v: 'Form', l: { Target: 'https://example.org/form' } }
					},
					merges: ['A1:C1']
				}
			])
		);
		const { text, truncation } = renderSheetText(wb.sheets[0]!);
		expect(truncation).toBeUndefined();
		expect(text).toBe(
			[
				'=== Sheet "Tasks" · used A1:C5 · 5 rows',
				'merged: A1:C1',
				'region A1:C5 · header row 2: Task, Owner, Due · row labels in A',
				'r1: A1 Newborn checklist [merged A1:C1]',
				'r2: A2 Task | B2 Owner | C2 Due',
				'r3: A3 Register birth | B3 Sam \\| Alex | C3 01/03/2024 [date 2024-03-01]',
				'r4: A4 Total | B4 1 [=COUNTA(A3:A3)]',
				'r5: A5 Line one\\nLine two [note Alex: Ask GP] | B5 Form [link https://example.org/form]'
			].join('\n')
		);
	});

	it('mentions hidden, empty and oversized declared ranges', () => {
		const wb = readWorkbook(
			buildWorkbook([
				{ name: 'Lookup', rows: [['k', 'v']], hidden: true, declaredRange: 'A1:Z9000' },
				{ name: 'Blank', rows: [] }
			])
		);
		expect(renderSheetText(wb.sheets[0]!).text).toBe(
			'=== Sheet "Lookup" · hidden · used A1:B1 · 1 rows · declared A1:Z9000\nr1: A1 k | B1 v'
		);
		expect(renderSheetText(wb.sheets[1]!).text).toBe('=== Sheet "Blank" · empty');
	});

	it('stops at the character budget and reports the omitted rows', () => {
		const rows = [
			['Day', 'Note'],
			...Array.from({ length: 200 }, (_, i) => [`Day ${i + 1}`, `Feed and nap ${i}`])
		];
		const sheet = readWorkbook(buildWorkbook([{ name: 'Log', rows }])).sheets[0]!;
		const { text, truncation } = renderSheetText(sheet, { maxChars: 1500 });

		expect(text.length).toBeLessThanOrEqual(1500);
		expect(truncation?.rowsTotal).toBe(201);
		expect(truncation?.rowsShown).toBeGreaterThan(5);
		expect(truncation?.rowsShown).toBeLessThan(201);
		const firstOmitted = truncation!.rowsShown + 1;
		expect(truncation?.omittedRows).toEqual({ sheet: 'Log', ref: `A${firstOmitted}:B201` });
		const lines = text.split('\n');
		expect(lines.at(-2)).toMatch(new RegExp(`^r${firstOmitted - 1}: `));
		expect(lines.at(-1)).toBe(
			`[truncated: showing ${truncation!.rowsShown} of 201 rows; ${201 - truncation!.rowsShown} rows omitted (A${firstOmitted}:B201)]`
		);
	});

	it('clips long cell text and caps wide rows', () => {
		const sheet = readWorkbook(
			buildWorkbook([
				{
					name: 'Wide',
					rows: [
						['Activity', ...Array.from({ length: 60 }, (_, i) => `Wk ${i + 1}`)],
						['Story', 'x'.repeat(500)]
					]
				}
			])
		).sheets[0]!;
		const { text, truncation } = renderSheetText(sheet, { maxCellChars: 50, maxCellsPerRow: 10 });
		expect(truncation).toEqual({ rowsShown: 2, rowsTotal: 2, clippedCells: 1, omittedCells: 51 });
		expect(text).toContain('| J1 Wk 9 | ... +51 cells to BI1');
		expect(text).toContain(`B2 ${'x'.repeat(50)}...(+450 chars)`);
		expect(text.split('\n').at(-1)).toBe(
			'[truncated: 1 cells clipped to 50 chars; 51 cells beyond 10 per row omitted]'
		);
	});

	it('keeps wide headers and many regions inside the budget', () => {
		const header = Array.from({ length: 300 }, (_, i) => `Week ${i + 1} label`);
		const rows: (string | null)[][] = [];
		for (let r = 0; r < 20; r++) rows.push(header.slice(0, 60), header.slice(0, 60), [], []);
		const wide = readWorkbook(buildWorkbook([{ name: 'Wide', rows: [header, header] }])).sheets[0]!;
		const wideText = renderSheetText(wide, { maxChars: 12_000 }).text;
		expect(wideText.length).toBeLessThanOrEqual(12_000);
		expect(wideText).toContain('Week 30 label, +270 more');

		const many = readWorkbook(buildWorkbook([{ name: 'Many', rows }])).sheets[0]!;
		expect(many.regions.length).toBeGreaterThan(5);
		const { text, truncation } = renderSheetText(many, { maxChars: 2000 });
		expect(text.length).toBeLessThanOrEqual(2000);
		expect(truncation?.omittedHeaderLines).toBeGreaterThan(0);
		expect(text.split('\n').at(-1)).toMatch(/^\[truncated: \d+ header lines omitted; /);
	});
});

describe('renderWorkbookText', () => {
	const rows = Array.from({ length: 80 }, (_, i) => [`Item ${i + 1}`, i]);
	const wb = readWorkbook(
		buildWorkbook([
			{ name: 'One', rows },
			{ name: 'Two', rows },
			{ name: 'Three', rows }
		])
	);

	it('renders every sheet when the budget allows', () => {
		const result = renderWorkbookText(wb);
		expect(result.omittedSheets).toEqual([]);
		expect(result.sheets.map((s) => s.sheet)).toEqual(['One', 'Two', 'Three']);
		expect(result.text).toContain('=== Sheet "Two"');
	});

	it('names the sheets that did not fit the workbook budget', () => {
		const result = renderWorkbookText(wb, { maxTotalChars: 1800, maxChars: 1000 });
		expect(result.text.length).toBeLessThanOrEqual(1800);
		expect(result.sheets[0]?.truncation?.rowsShown).toBeLessThan(80);
		expect(result.omittedSheets.length).toBeGreaterThan(0);
		expect(result.text.split('\n').at(-1)).toBe(
			`[omitted sheets: ${result.omittedSheets.map((n) => `"${n}"`).join(', ')}]`
		);
	});

	it('caps the omitted-sheets line so the workbook budget holds', () => {
		const many = readWorkbook(
			buildWorkbook(Array.from({ length: 60 }, (_, i) => ({ name: `Sheet number ${i + 1}`, rows })))
		);
		const result = renderWorkbookText(many, { maxTotalChars: 3000, maxChars: 1000 });
		expect(result.text.length).toBeLessThanOrEqual(3000);
		expect(result.omittedSheets.length).toBeGreaterThan(50);
		expect(result.text.split('\n').at(-1)).toMatch(
			/^\[omitted sheets: "Sheet number \d+", .* \+\d+ more\]$/
		);
	});
});
