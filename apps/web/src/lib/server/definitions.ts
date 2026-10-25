/**
 * The one place the web app gets process definitions from: the store, read as the signed-in
 * user, so only namespaces they can read appear, each with what they may do there.
 */
import { listDefinitions, type Actor, type DefinitionForActor } from '@casebook/store';
import type { LoadedDefinition, Workspace } from '$lib/definitions/types';
import { getDb } from './db';

/** Every namespace the actor can read, with its definitions, ordered by path. */
export async function loadWorkspaces(actor: Actor): Promise<Workspace[]> {
	const namespaces = await listDefinitions(getDb(), actor);
	return namespaces.map(({ namespace, can, definitions }) => ({
		id: namespace.id,
		namespace: namespace.path,
		label: namespaceLabel(namespace.path),
		definitions: definitions.filter((d) => d.draft ?? d.published).map(toLoaded),
		can
	}));
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
