// One request on a spreadsheet import, as the signed-in user: running the agent, changing the
// split, or accepting, rejecting or publishing what it drafted. Answers with the import's new version.
import { error, json } from '@sveltejs/kit';
import { act } from '$lib/server/wizard';
import type { WizardAction } from '$lib/wizard/types';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) error(401, 'Sign in first');
	let body: WizardAction & { version?: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ ok: false, reason: 'The request was not valid JSON' }, { status: 400 });
	}
	const result = await act({ id: locals.user.id }, params.id, body, Number(body.version));
	return json(result, { status: result.ok ? 200 : result.status });
};
