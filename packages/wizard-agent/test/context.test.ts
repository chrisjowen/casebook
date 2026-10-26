import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { readWorkbook } from '@casebook/sheet-import';
import {
	INLINE_CHARS,
	memoryDrafts,
	rangesText,
	sampleWorkbook,
	SAMPLE_FILE_NAME,
	startState,
	wizard,
	workbookOpening
} from '../src/index.js';
import { answer, call, ScriptedModel } from './fake-model.js';

/** A synthetic tracker large enough that it is not shown whole: 3 sheets of 250 tasks. */
function largeWorkbook() {
	const book = XLSX.utils.book_new();
	for (const name of ['Before', 'During', 'After']) {
		const rows = [['Task', 'Who', 'When', 'Notes']];
		for (let i = 1; i <= 250; i++)
			rows.push([`${name} task ${i}`, 'Parent', `Week ${i}`, 'Synthetic note']);
		XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
	}
	return readWorkbook(new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' })));
}

describe('what of the workbook the agent is shown', () => {
	it('shows a small workbook whole', () => {
		const opening = workbookOpening(readWorkbook(sampleWorkbook()), SAMPLE_FILE_NAME);
		expect(opening).toMatch(/^Here it is:/);
		expect(opening).toContain('=== Sheet "Claims"');
	});

	it('shows a large one as its tables and first rows, plus the cells being drafted', () => {
		const workbook = largeWorkbook();
		const opening = workbookOpening(workbook, 'big.xlsx', {
			title: 'During',
			sources: [{ sheet: 'During', range: 'A100:D102' }]
		});
		expect(opening).toMatch(/It is large.*read_cells/s);
		expect(opening).toContain('- "Before" A1:D251: Task, Who, When, Notes (250 rows)');
		expect(opening).toContain('Before task 3');
		expect(opening).not.toContain('Before task 40');
		expect(opening).toContain('During task 99');
		expect(opening.length).toBeLessThan(INLINE_CHARS * 3);
	});

	it('renders only the cells inside a range', () => {
		const text = rangesText(largeWorkbook(), [{ sheet: 'After', range: 'A10:B11' }], 5_000);
		expect(text).toContain('After task 9');
		expect(text).toContain('After task 10');
		expect(text).not.toContain('After task 11');
		expect(text).not.toContain('Week');
	});
});

describe('a turn as it runs', () => {
	it('reports what it is doing', async () => {
		const seen: string[] = [];
		const model = new ScriptedModel([
			call('propose_split', {
				processes: [
					{ title: 'Claims', summary: 'Claims', sources: [{ sheet: 'Claims', range: 'A2:F8' }] }
				]
			}),
			answer('One process.')
		]);
		await wizard.proposeSplit(
			{
				model,
				drafts: memoryDrafts(),
				workbook: readWorkbook(sampleWorkbook()),
				onProgress: (a) => seen.push(a)
			},
			startState(SAMPLE_FILE_NAME)
		);
		expect(seen).toEqual([
			'Reading the spreadsheet',
			'Checking the 1 proposed process',
			'Thinking it over'
		]);
	});

	it('stops when it is aborted', async () => {
		const controller = new AbortController();
		const model = new ScriptedModel([
			() => {
				controller.abort(new Error('The assistant took too long'));
				return call('read_cells', { ranges: [{ sheet: 'Claims', range: 'A1:F8' }] })([]);
			},
			answer('Too late.')
		]);
		await expect(
			wizard.proposeSplit(
				{
					model,
					drafts: memoryDrafts(),
					workbook: readWorkbook(sampleWorkbook()),
					signal: controller.signal
				},
				startState(SAMPLE_FILE_NAME)
			)
		).rejects.toThrow();
	});
});
