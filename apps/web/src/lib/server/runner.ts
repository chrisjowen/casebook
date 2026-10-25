/**
 * What the runner's server code shares: who is acting, the file store for evidence, and turning
 * the store's refusals into HTTP errors or form failures.
 */
import { error, fail } from '@sveltejs/kit';
import {
	filesDirectory,
	localFileStore,
	type Actor,
	type FileStore,
	type ReadRefusal,
	type RuntimeRefusal,
	type UserSummary
} from '@casebook/store';

/** The signed-in user, whom every read and write acts as. */
export function actorOf(locals: App.Locals): Actor {
	if (!locals.user) error(401, 'Sign in first');
	return { id: locals.user.id };
}

/**
 * The signed-in guest as their own pages see them: their roles by name alone, without the
 * account, namespace path or case each is bound on, which belong to the host.
 */
export function guestOf(locals: App.Locals): UserSummary {
	if (!locals.user) error(401, 'Sign in first');
	const { id, displayName, roles } = locals.user;
	return { id, displayName, roles: [...new Set(roles.map((r) => r.split(' ')[0]!))] };
}

let files: FileStore | undefined;

/** Uploaded evidence lives on local disk, in `CASEBOOK_FILES_DIR` or `.casebook/files`. */
export function fileStore(): FileStore {
	files ??= localFileStore(filesDirectory());
	return files;
}

/** The value of a read, or the HTTP error its refusal stands for. */
export function orError<T extends object>(result: T | ReadRefusal): T {
	if ('ok' in result && result.ok === false) {
		const refusal = result as ReadRefusal;
		error(refusal.code === 'access-denied' ? 403 : 404, refusal.reason);
	}
	return result as T;
}

const STATUS: Record<RuntimeRefusal['code'], number> = {
	'access-denied': 403,
	'not-found': 404,
	'not-published': 409,
	'not-ready': 409,
	'already-done': 409,
	'invalid-input': 400,
	'human-only': 403
};

/** A refused write as a form failure, keeping its reason and the problem with each field. */
export function refused(result: RuntimeRefusal) {
	return fail(STATUS[result.code], {
		code: result.code,
		reason: result.reason,
		problems: Object.fromEntries(result.problems.map((p) => [p.field, p.message]))
	});
}
