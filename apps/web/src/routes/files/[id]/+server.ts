import { error } from '@sveltejs/kit';
import { findCaseFile } from '@casebook/store';
import { getDb } from '$lib/server/db';
import { actorOf, fileStore, orError } from '$lib/server/runner';
import type { RequestHandler } from './$types';

/** Types a browser may show in place; anything else, HTML and SVG included, downloads. */
const INLINE = new Set([
	'application/pdf',
	'image/png',
	'image/jpeg',
	'image/gif',
	'image/webp',
	'text/plain'
]);

/** A case file, for someone who can open its case, or a guest whose form uses it. */
export const GET: RequestHandler = async ({ params, locals }) => {
	const file = orError(await findCaseFile(getDb(), actorOf(locals), params.id));
	const bytes = await fileStore().get(file.storageKey);
	if (!bytes) error(404, 'The file is missing from the file store.');
	const inline = INLINE.has(file.contentType);
	return new Response(new Uint8Array(bytes), {
		headers: {
			'content-type': inline ? file.contentType : 'application/octet-stream',
			'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
			// Uploaded files never run as part of the app.
			'content-security-policy': 'sandbox',
			'x-content-type-options': 'nosniff',
			'cache-control': 'private, no-store'
		}
	});
};
