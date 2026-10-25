// Users and the roles they hold, for choosing who to sign in as.
import { and, asc, eq } from 'drizzle-orm';
import type { Db } from './client.js';
import { accounts, cases, namespaces, principals, roleBindings } from './schema.js';

/**
 * A user and their role bindings in plain words, such as `write on acme/eng`. Roles on single
 * cases are listed only where the user is a guest, with no account role.
 */
export interface UserSummary {
	id: string;
	displayName: string;
	roles: string[];
}

/** The users of an issuer, by name, with the roles bound to each. */
export async function listUsers(db: Db, issuer: string): Promise<UserSummary[]> {
	const users = await db
		.select({ id: principals.id, displayName: principals.displayName })
		.from(principals)
		.where(and(eq(principals.issuer, issuer), eq(principals.kind, 'user')))
		.orderBy(asc(principals.displayName));
	return Promise.all(users.map(async (u) => ({ ...u, roles: await rolesOf(db, u.id) })));
}

/** The user with this id, if it is a user of the issuer. */
export async function findUser(
	db: Db,
	issuer: string,
	id: string
): Promise<UserSummary | undefined> {
	if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
	const [user] = await db
		.select({ id: principals.id, displayName: principals.displayName })
		.from(principals)
		.where(and(eq(principals.id, id), eq(principals.issuer, issuer), eq(principals.kind, 'user')));
	return user && { ...user, roles: await rolesOf(db, user.id) };
}

async function rolesOf(db: Db, principalId: string): Promise<string[]> {
	const rows = await db
		.select({
			role: roleBindings.role,
			account: accounts.slug,
			namespace: namespaces.path,
			caseTitle: cases.title
		})
		.from(roleBindings)
		.innerJoin(accounts, eq(accounts.id, roleBindings.accountId))
		.leftJoin(namespaces, eq(namespaces.id, roleBindings.namespaceId))
		.leftJoin(cases, eq(cases.id, roleBindings.caseId))
		.where(eq(roleBindings.principalId, principalId))
		.orderBy(asc(roleBindings.scopeType), asc(namespaces.path), asc(roleBindings.role));
	// Owners and admins are namespace-admin everywhere in their account, so those say nothing more.
	const admin = new Set(
		rows
			.filter((r) => r.namespace === null && ['account-owner', 'account-admin'].includes(r.role))
			.map((r) => r.account)
	);
	// Roles on single cases are listed only for guests, who hold nothing else there.
	const members = new Set(rows.filter((r) => r.namespace === null).map((r) => r.account));
	return rows
		.filter((r) => !(r.role === 'namespace-admin' && admin.has(r.account)))
		.filter((r) => r.caseTitle === null || !members.has(r.account))
		.map((r) =>
			r.caseTitle !== null
				? `${r.role} on case "${r.caseTitle}"`
				: r.namespace === null
					? `${r.role} of ${r.account}`
					: `${r.role} on ${r.namespace}`
		);
}
