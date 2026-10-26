import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { demoUsers, devSignInEnabled, signIn, signOut } from '$lib/server/session';

export const load: PageServerLoad = async ({ locals }) => {
	if (!devSignInEnabled()) return { enabled: false, users: [], current: undefined };
	try {
		return { enabled: true, users: await demoUsers(), current: locals.user?.id };
	} catch (error) {
		return {
			enabled: true,
			users: [],
			current: undefined,
			problem: error instanceof Error ? error.message : String(error)
		};
	}
};

export const actions: Actions = {
	signin: async ({ request, cookies, url }) => {
		const id = String((await request.formData()).get('user') ?? '');
		if (!(await signIn(cookies, url, id)))
			return fail(400, { reason: 'Choose one of the demo users.' });
		redirect(303, '/');
	},
	signout: async ({ cookies, url }) => {
		signOut(cookies, url);
		redirect(303, '/signin');
	}
};
