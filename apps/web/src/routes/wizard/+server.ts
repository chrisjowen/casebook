// Starts a spreadsheet import in a workspace from an uploaded .xlsx, or from the sample tracker.
import { error, json } from '@sveltejs/kit';
import { SAMPLE_FILE_NAME, sampleWorkbook } from '@casebook/wizard-agent';
import { startImport } from '$lib/server/wizard';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) error(401, 'Sign in first');
	const form = await request.formData();
	const namespaceId = String(form.get('namespaceId') ?? '');
	const file = form.get('file');
	let fileName: string;
	let bytes: Uint8Array;
	if (form.get('sample') === '1') {
		fileName = SAMPLE_FILE_NAME;
		bytes = sampleWorkbook();
	} else if (file instanceof File && file.size > 0) {
		fileName = file.name.replace(/[\\/]/g, '_') || 'workbook.xlsx';
		bytes = new Uint8Array(await file.arrayBuffer());
	} else {
		return json({ ok: false, reason: 'Choose an .xlsx file to import' }, { status: 400 });
	}
	const result = await startImport({ id: locals.user.id }, { namespaceId, fileName, bytes });
	return json(result, { status: result.ok ? 201 : result.status });
};
