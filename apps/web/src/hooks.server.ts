import { redirect, type Handle } from '@sveltejs/kit';
import { currentUser } from '$lib/server/session';

/** Resolves the signed-in user; everything except the sign-in page needs one. */
export const handle: Handle = async ({ event, resolve }) => {
	try {
		event.locals.user = await currentUser(event.cookies);
	} catch (error) {
		// The sign-in page explains a database that is down or not set up.
		console.error(error);
		event.locals.user = undefined;
	}
	if (!event.locals.user && !event.url.pathname.startsWith('/signin')) {
		redirect(303, '/signin');
	}
	return resolve(event);
};
