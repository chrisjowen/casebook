// The synthetic sample tracker, as an .xlsx download.
import { SAMPLE_FILE_NAME, sampleWorkbook } from '@casebook/wizard-agent';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () =>
	new Response(sampleWorkbook() as Uint8Array<ArrayBuffer>, {
		headers: {
			'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
			'content-disposition': `attachment; filename="${SAMPLE_FILE_NAME}"`
		}
	});
