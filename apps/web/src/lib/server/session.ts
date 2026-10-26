/**
 * Dev sign-in: choose one of the seeded demo users, with no password. It stands in for the OIDC
 * sign-in to come and is on only in development builds, or in a production build that sets
 * CASEBOOK_DEMO_SIGNIN=on, as the local Kubernetes deploy does.
 */
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import type { Cookies } from '@sveltejs/kit';
import { DEMO_ISSUER, findUser, listUsers, type UserSummary } from '@casebook/store';
import { getDb } from './db';

const COOKIE = 'casebook_dev_user';

export const devSignInEnabled = () => dev || env.CASEBOOK_DEMO_SIGNIN === 'on';

/** The signed-in demo user, if the cookie names one. */
export async function currentUser(cookies: Cookies): Promise<UserSummary | undefined> {
	const id = cookies.get(COOKIE);
	if (!id || !devSignInEnabled()) return undefined;
	return findUser(getDb(), DEMO_ISSUER, id);
}

export const demoUsers = () => listUsers(getDb(), DEMO_ISSUER);

export async function signIn(cookies: Cookies, id: string): Promise<UserSummary | undefined> {
	const user = devSignInEnabled() ? await findUser(getDb(), DEMO_ISSUER, id) : undefined;
	if (user) {
		cookies.set(COOKIE, user.id, { path: '/', httpOnly: true, sameSite: 'lax', secure: !dev });
	}
	return user;
}

export const signOut = (cookies: Cookies) => cookies.delete(COOKIE, { path: '/' });
