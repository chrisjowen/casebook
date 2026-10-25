import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, parent }) => {
	const { case: c } = await parent();
	const process = c.processes.find((p) => p.id === params.attachment);
	if (!process) error(404, 'That process is not on this case.');
	return { process };
};
