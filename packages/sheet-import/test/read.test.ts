import { describe, expect, it } from 'vitest';
import { readWorkbook, SheetImportError, type Cell, type Sheet } from '../src/index.js';
import { buildWorkbook, dateCell, formulaCell } from './fixtures.js';

function sheetOf(bytes: Uint8Array, name?: string): Sheet {
	const wb = readWorkbook(bytes);
	const sheet = name ? wb.sheets.find((s) => s.name === name) : wb.sheets[0];
	if (!sheet) throw new Error(`no sheet ${name ?? '(first)'}`);
	return sheet;
}

function cellAt(sheet: Sheet, address: string): Cell {
	const cell = sheet.rows.flatMap((r) => r.cells).find((c) => c.address === address);
	if (!cell) throw new Error(`no cell ${address}`);
	return cell;
}

describe('several unrelated tables on one sheet', () => {
	const sheet = sheetOf(
		buildWorkbook([
			{
				name: 'Household',
				rows: [
					['Before the birth'],
					['Task', 'Owner', 'Done'],
					['Pack hospital bag', 'Alex', true],
					['Fit car seat', 'Sam', false],
					[],
					[],
					['Contacts'],
					['Name', 'Phone'],
					['Midwife', '01234 567890'],
					['GP surgery', '01234 000111'],
					[],
					['Budget', 'Amount'],
					['Nappies', 40],
					['Formula', 25.5]
				],
				merges: ['A1:C1']
			}
		])
	);

	it('splits the sheet into one region per table at blank rows', () => {
		expect(sheet.regions.map((r) => r.range)).toEqual(['A1:C4', 'A7:B10', 'A12:B14']);
		expect(sheet.source).toEqual({ sheet: 'Household', ref: 'A1:C14' });
	});

	it('finds the header row under a title row', () => {
		const [checklist, contacts, budget] = sheet.regions;
		expect(checklist?.header).toMatchObject({
			row: 2,
			labels: { A: 'Task', B: 'Owner', C: 'Done' },
			source: { sheet: 'Household', ref: 'A2:C2' }
		});
		expect(checklist?.header?.reasons).toEqual(
			expect.arrayContaining(['all-text', 'below-title', 'followed-by-data'])
		);
		expect(contacts?.header?.row).toBe(8);
		expect(budget?.header).toMatchObject({ row: 12, labels: { A: 'Budget', B: 'Amount' } });
	});

	it('records merged ranges on the sheet and the anchor cell', () => {
		expect(sheet.merges).toEqual([
			{ source: { sheet: 'Household', ref: 'A1:C1' }, range: 'A1:C1' }
		]);
		expect(cellAt(sheet, 'A1').merge).toBe('A1:C1');
	});

	it('splits side-by-side tables at blank columns', () => {
		const side = sheetOf(
			buildWorkbook([
				{
					name: 'Side',
					rows: [
						['Item', 'Qty', null, 'Who', 'When'],
						['Cot', 1, null, 'Alex', 'Mon'],
						['Bottles', 6, null, 'Sam', 'Tue']
					]
				}
			])
		);
		expect(side.regions.map((r) => r.range)).toEqual(['A1:B3', 'D1:E3']);
	});
});

describe('multi-line cell text', () => {
	it('keeps line breaks and normalises CRLF to LF', () => {
		const sheet = sheetOf(
			buildWorkbook([
				{
					name: 'Notes',
					rows: [
						['Step', 'Details'],
						['Register birth', 'Book online\nBring both parents\r\nTake ID']
					]
				}
			])
		);
		const cell = cellAt(sheet, 'B2');
		expect(cell.value).toEqual({
			type: 'string',
			value: 'Book online\nBring both parents\nTake ID'
		});
		expect(cell.text).toBe('Book online\nBring both parents\nTake ID');
	});
});

describe('grid / matrix sheets', () => {
	const sheet = sheetOf(
		buildWorkbook([
			{
				name: 'Requirements',
				rows: [
					['Document', 'Passport', 'Child benefit', 'Nursery place'],
					['Birth certificate', 'Original\nplus copy', 'Original', 'Copy'],
					['Proof of address', null, 'Council tax bill', 'Utility bill\nunder 3 months'],
					['Parent photo ID', 'Countersigned photo', null, 'Passport or licence']
				]
			}
		])
	);

	it('marks the header row and the column of row labels', () => {
		const [region] = sheet.regions;
		expect(region?.range).toBe('A1:D4');
		expect(region?.header?.labels).toEqual({
			A: 'Document',
			B: 'Passport',
			C: 'Child benefit',
			D: 'Nursery place'
		});
		expect(region?.rowLabelColumn).toBe('A');
	});

	it('keeps requirement text at its intersection, leaving blanks out', () => {
		expect(cellAt(sheet, 'D3').text).toBe('Utility bill\nunder 3 months');
		const row3 = sheet.rows.find((r) => r.row === 3);
		expect(row3?.cells.map((c) => c.address)).toEqual(['A3', 'C3', 'D3']);
	});
});

describe('week / month timeline sheets', () => {
	const weeks = Array.from({ length: 52 }, (_, i) => `Wk ${i + 1}`);
	const sheet = sheetOf(
		buildWorkbook([
			{
				name: 'Timeline',
				rows: [
					['Activity', ...weeks],
					['Feeds logged', ...weeks.map((_, i) => (i % 2 === 0 ? 'x' : null))],
					['Health visitor', ...weeks.map((_, i) => (i === 1 || i === 7 ? 'visit' : null))],
					['Weight (kg)', ...weeks.map((_, i) => 3.4 + i * 0.1)]
				]
			}
		])
	);

	it('covers all parallel columns in one region', () => {
		expect(sheet.source?.ref).toBe('A1:BA4');
		expect(sheet.regions).toHaveLength(1);
		expect(sheet.regions[0]?.header?.labels['BA']).toBe('Wk 52');
		expect(sheet.rows[0]?.cells).toHaveLength(53);
	});

	it('keeps sparse marks at their week column', () => {
		const visits = sheet.rows.find((r) => r.row === 3)?.cells.map((c) => c.address);
		expect(visits).toEqual(['A3', 'C3', 'I3']);
	});
});

describe('long empty trailing ranges', () => {
	it('bounds the used range to content, ignoring the declared dimension', () => {
		const sheet = sheetOf(
			buildWorkbook([
				{
					name: 'Tracker',
					rows: [
						['Task', 'Due'],
						['Book scan', dateCell(45352)]
					],
					cells: {
						Z5000: { t: 's', v: '' },
						C300: { t: 's', v: '   ' },
						D900: { t: 'z' },
						// A formula pre-filled far below the data, showing nothing.
						B4000: { t: 's', v: '', f: 'IF(A4000="","",A4000)' }
					},
					declaredRange: 'A1:Z5000'
				}
			])
		);
		expect(sheet.declaredRange).toBe('A1:Z5000');
		expect(sheet.source).toEqual({ sheet: 'Tracker', ref: 'A1:B2' });
		expect(sheet.rows.map((r) => r.row)).toEqual([1, 2]);
		expect(sheet.limits).toBeUndefined();
	});

	it('drops content past maxRows / maxCols and reports how much', () => {
		const bytes = buildWorkbook([
			{
				name: 'Big',
				rows: [['a', 'b', 'c']],
				cells: { A50: { t: 's', v: 'far down' }, H1: { t: 's', v: 'far right' } }
			}
		]);
		const sheet = readWorkbook(bytes, { maxRows: 20, maxCols: 5 }).sheets[0]!;
		expect(sheet.source?.ref).toBe('A1:C1');
		expect(sheet.limits).toEqual({ droppedCells: 2, maxRows: 20, maxCols: 5 });
	});

	it('reports an empty sheet with no source range', () => {
		const sheet = sheetOf(buildWorkbook([{ name: 'Blank', rows: [] }]));
		expect(sheet.source).toBeNull();
		expect(sheet.rows).toEqual([]);
		expect(sheet.regions).toEqual([]);
	});
});

describe('typed values', () => {
	const sheet = sheetOf(
		buildWorkbook([
			{
				name: 'Types',
				rows: [
					[
						'text',
						42.5,
						true,
						dateCell(45352),
						dateCell(45352.375, 'yyyy-mm-dd hh:mm'),
						dateCell(0.5, 'hh:mm'),
						{ t: 'e', v: 7, w: '#DIV/0!' },
						formulaCell('B1*2', 85),
						formulaCell('A1&"!"', 'text!'),
						{ t: 'n', v: 0.25, z: '0%' },
						dateCell(45352, 'mmmm'),
						dateCell(45352, '[$-409]mmm;@'),
						dateCell(0.75, '[h]:mm')
					]
				]
			}
		])
	);
	const values = sheet.rows[0]!.cells.map((c) => [c.address, c.value, c.raw]);

	it('types strings, numbers, booleans, dates, times and errors', () => {
		expect(values.slice(0, 7)).toEqual([
			['A1', { type: 'string', value: 'text' }, 'text'],
			['B1', { type: 'number', value: 42.5 }, 42.5],
			['C1', { type: 'boolean', value: true }, true],
			['D1', { type: 'date', value: '2024-03-01' }, 45352],
			['E1', { type: 'date', value: '2024-03-01T09:00:00' }, 45352.375],
			['F1', { type: 'date', value: '12:00:00' }, 0.5],
			['G1', { type: 'error', value: '#DIV/0!' }, '#DIV/0!']
		]);
	});

	it('keeps the date for month-only formats and the time for elapsed-hour formats', () => {
		expect(values.slice(10)).toEqual([
			['K1', { type: 'date', value: '2024-03-01' }, 45352],
			['L1', { type: 'date', value: '2024-03-01' }, 45352],
			['M1', { type: 'date', value: '18:00:00' }, 0.75]
		]);
	});

	it('gives formula cells their cached result plus the formula', () => {
		expect(cellAt(sheet, 'H1')).toMatchObject({
			formula: 'B1*2',
			value: { type: 'number', value: 85 }
		});
		expect(cellAt(sheet, 'I1')).toMatchObject({
			formula: 'A1&"!"',
			value: { type: 'string', value: 'text!' }
		});
	});

	it('keeps displayed text and number format apart from the value', () => {
		expect(cellAt(sheet, 'J1')).toMatchObject({
			text: '25%',
			numberFormat: '0%',
			value: { value: 0.25 }
		});
		expect(cellAt(sheet, 'D1').text).toBe('2024-03-01');
		expect(cellAt(sheet, 'C1').text).toBe('TRUE');
	});

	it('honours the 1904 date system', () => {
		const wb = readWorkbook(
			buildWorkbook([{ name: 'Mac', rows: [[dateCell(0)]] }], { date1904: true })
		);
		expect(wb.date1904).toBe(true);
		expect(wb.sheets[0]?.rows[0]?.cells[0]?.value).toEqual({ type: 'date', value: '1904-01-01' });
	});
});

describe('hyperlinks, comments and hidden sheets', () => {
	const wb = readWorkbook(
		buildWorkbook([
			{
				name: 'Links',
				rows: [['Form', 'Status']],
				cells: {
					A2: {
						t: 's',
						v: 'Apply for child benefit',
						l: { Target: 'https://example.org/child-benefit', Tooltip: 'Online form' }
					},
					B2: { t: 's', v: 'Waiting', c: [{ a: 'Alex', t: 'Chased on\nMonday' }] },
					// A note on an otherwise empty cell is still content.
					C5: { t: 'z', c: [{ t: 'Check this later' }] }
				}
			},
			{ name: 'Lookup', rows: [['x']], hidden: true }
		])
	);
	const sheet = wb.sheets[0]!;

	it('reads hyperlinks with their tooltip', () => {
		expect(cellAt(sheet, 'A2').hyperlink).toEqual({
			target: 'https://example.org/child-benefit',
			tooltip: 'Online form'
		});
	});

	it('reads cell comments with their author', () => {
		expect(cellAt(sheet, 'B2').comments).toEqual([{ author: 'Alex', text: 'Chased on\nMonday' }]);
		expect(cellAt(sheet, 'C5')).toMatchObject({
			value: { type: 'empty' },
			comments: [{ text: 'Check this later' }]
		});
		expect(sheet.source?.ref).toBe('A1:C5');
	});

	it('flags hidden sheets', () => {
		expect(wb.sheets.map((s) => [s.name, s.hidden, s.index])).toEqual([
			['Links', false, 0],
			['Lookup', true, 1]
		]);
	});
});

describe('source references', () => {
	const wb = readWorkbook(
		buildWorkbook([
			{ name: 'First', rows: [['a']] },
			{
				name: "Kid's plan",
				rows: [['Title'], ['Item', 'When'], [null, 'Mon'], ['Bath', 'Tue']],
				merges: ['A1:B1']
			}
		])
	);
	const sheet = wb.sheets[1]!;

	it('points every cell at its sheet and A1 address', () => {
		for (const row of sheet.rows) {
			for (const cell of row.cells) {
				expect(cell.source).toEqual({ sheet: "Kid's plan", ref: cell.address });
				expect(cell.address).toBe(`${String.fromCharCode(64 + cell.col)}${cell.row}`);
			}
		}
	});

	it('gives rows, merges, regions and the sheet range references', () => {
		expect(sheet.rows.map((r) => r.source.ref)).toEqual(['A1', 'A2:B2', 'B3', 'A4:B4']);
		expect(sheet.merges[0]?.source).toEqual({ sheet: "Kid's plan", ref: 'A1:B1' });
		expect(sheet.regions[0]?.source).toEqual({ sheet: "Kid's plan", ref: 'A1:B4' });
		expect(sheet.source).toEqual({ sheet: "Kid's plan", ref: 'A1:B4' });
	});

	it('produces a JSON-serializable model', () => {
		expect(JSON.parse(JSON.stringify(wb))).toEqual(wb);
	});
});

describe('input validation', () => {
	it('rejects bytes that are not an .xlsx container', () => {
		expect(() => readWorkbook(new TextEncoder().encode('Name,Phone\nA,1'))).toThrow(
			SheetImportError
		);
	});

	it('accepts an ArrayBuffer', () => {
		const bytes = buildWorkbook([{ name: 'S', rows: [['ok']] }]);
		const buffer = bytes.buffer.slice(
			bytes.byteOffset,
			bytes.byteOffset + bytes.byteLength
		) as ArrayBuffer;
		expect(readWorkbook(buffer).sheets[0]?.rows[0]?.cells[0]?.text).toBe('ok');
	});
});
