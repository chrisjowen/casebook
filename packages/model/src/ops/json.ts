/** Helpers for the plain JSON values definitions are made of. Nothing here mutates its input. */

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Deep equality for JSON values; object key order does not matter. */
export function isEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (Array.isArray(a)) {
		return Array.isArray(b) && a.length === b.length && a.every((item, i) => isEqual(item, b[i]));
	}
	if (!isRecord(a) || !isRecord(b)) return false;
	const keys = Object.keys(a);
	return (
		keys.length === Object.keys(b).length &&
		keys.every((key) => Object.hasOwn(b, key) && isEqual(a[key], b[key]))
	);
}

/** Deep copy of a JSON value. */
export function clone<T>(value: T): T {
	if (Array.isArray(value)) return value.map(clone) as T;
	if (!isRecord(value)) return value;
	return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)])) as T;
}

/** Freezes a JSON value and everything inside it, so it can be shared without being changed. */
export function deepFreeze<T>(value: T): T {
	if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const item of Object.values(value)) deepFreeze(item);
	}
	return value;
}

/**
 * Applies a JSON Merge Patch (RFC 7386): objects merge key by key, `null` removes a key, and any
 * other value, arrays included, replaces what was there. Returns a new value.
 */
export function mergePatch(target: unknown, patch: unknown): unknown {
	if (!isRecord(patch)) return clone(patch);
	const result: Record<string, unknown> = isRecord(target) ? { ...target } : {};
	for (const [key, value] of Object.entries(patch)) {
		if (value === undefined) continue;
		if (value === null) {
			delete result[key];
		} else {
			result[key] = mergePatch(result[key], value);
		}
	}
	return result;
}
