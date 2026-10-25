import { describe, expect, it } from 'vitest';
import { readWorkbook } from '@casebook/sheet-import';
import { SAMPLE_FILE_NAME } from '@casebook/wizard-agent';
import { GET } from './+server';

describe('the sample download', () => {
	it('serves the sample tracker as an .xlsx file', async () => {
		const response = await GET({} as Parameters<typeof GET>[0]);
		expect(response.headers.get('content-type')).toBe(
			'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
		);
		expect(response.headers.get('content-disposition')).toBe(
			`attachment; filename="${SAMPLE_FILE_NAME}"`
		);
		const workbook = readWorkbook(new Uint8Array(await response.arrayBuffer()));
		expect(workbook.sheets.map((s) => s.name)).toContain('Birth reg');
	});
});
