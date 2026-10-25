/**
 * The one place the web app gets process definitions from: the store, read as the signed-in
 * user, so only namespaces they can read appear, each with what they may do there.
 */
import {
	listDefinitions,
	listSharedLookups,
	namespacePathPrefixes,
	type Actor,
	type DefinitionForActor,
	type SharedLookup
} from '@casebook/store';
import type { LoadedDefinition, SharedLookupRef, Workspace } from '$lib/definitions/types';
import { getDb } from './db';

/**
 * Every namespace the actor can read, with its definitions, ordered by path; only those of one
 * account (an instance) when its slug is given.
 */
export async function loadWorkspaces(actor: Actor, accountSlug?: string): Promise<Workspace[]> {
	const namespaces = (await listDefinitions(getDb(), actor)).filter(
		(n) => accountSlug === undefined || n.namespace.accountSlug === accountSlug
	);
	const lookups = new Map<string, SharedLookup[]>();
	for (const slug of new Set(namespaces.map((n) => n.namespace.accountSlug))) {
		lookups.set(
			slug,
			(await listSharedLookups(getDb(), actor, slug)).flatMap((n) => n.lookups)
		);
	}
	return namespaces.map(({ namespace, can, definitions }) => ({
		id: namespace.id,
		namespace: namespace.path,
		label: namespaceLabel(namespace.path),
		definitions: definitions.filter((d) => d.draft ?? d.published).map(toLoaded),
		lookups: visibleLookups(lookups.get(namespace.accountSlug) ?? [], namespace.path),
		can
	}));
}

/** The shared lookups a namespace's processes see: its own and its ancestors', nearest winning. */
function visibleLookups(all: SharedLookup[], path: string): SharedLookupRef[] {
	const seen = new Map<string, SharedLookupRef>();
	for (const prefix of namespacePathPrefixes(path)) {
		for (const l of all.filter((x) => x.namespace.path === prefix)) {
			if (seen.has(l.name)) continue;
			seen.set(l.name, {
				id: l.id,
				name: l.name,
				title: l.title,
				namespace: l.namespace.path,
				values: l.values
			});
		}
	}
	return [...seen.values()].sort((a, b) => a.title.localeCompare(b.title));
}

function toLoaded(d: DefinitionForActor): LoadedDefinition {
	const document = (d.draft ?? d.published)!.document;
	return {
		id: d.id,
		document,
		ok: d.check.ok,
		errors: d.check.errors,
		issues: d.check.issues,
		policy: d.changePolicy,
		requiresApproval: d.publishRequiresApproval,
		...(d.draft ? { revision: d.draft.number } : {}),
		undoable: d.draft?.undoable ?? false,
		...(d.published
			? {
					published: {
						version: d.published.version,
						at: d.published.publishedAt.toISOString(),
						by: d.published.publishedByName
					}
				}
			: {}),
		changes: d.published ? d.changes.map((c) => c.summary) : [],
		can: d.can
	};
}

/** "acme/eng/sre" reads as "SRE", "personal/example-user/family" as "Family". */
export function namespaceLabel(namespace: string): string {
	const last = namespace.split('/').at(-1) ?? namespace;
	const words = last.split('-');
	if (words.length === 1 && last.length <= 3) return last.toUpperCase();
	const text = words.join(' ');
	return text.charAt(0).toUpperCase() + text.slice(1);
}
