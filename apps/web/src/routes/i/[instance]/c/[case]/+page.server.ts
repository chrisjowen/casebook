import { casebookPeople, changeRoleHolders } from '@casebook/store';
import { getDb } from '$lib/server/db';
import { actorOf, orError, refused } from '$lib/server/runner';
import type { Actions, PageServerLoad } from './$types';

/** The people an owner or admin can name in who's who; nobody else gets the list. */
export const load: PageServerLoad = async ({ params, locals, parent }) => {
	const { case: c } = await parent();
	if (!c.can.manageRoles) return { people: [] };
	return { people: orError(await casebookPeople(getDb(), actorOf(locals), params.instance)) };
};

export const actions: Actions = {
	/** Sets who holds one role on the case: everyone checked, and nobody else. */
	roles: async ({ params, locals, request }) => {
		const form = await request.formData();
		const role = String(form.get('role') ?? '');
		const result = await changeRoleHolders(getDb(), actorOf(locals), {
			caseId: params.case,
			role,
			holders: form.getAll('holder').map(String)
		});
		if (!result.ok) return refused(result, { role });
		return { changed: role };
	}
};
