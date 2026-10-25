/**
 * The one place the web app gets process definitions from. Phase 1 loads the model package's
 * synthetic fixtures (ADR 0014); later phases swap this for the store without touching the UI.
 */
import { checkPublish, type DefinitionDocument } from '@casebook/model';
// The model package publishes its fixtures as source only, so they are imported by path.
import {
	birthRegistrationAbroad,
	incidentManagement
} from '../../../../../packages/model/fixtures/index.ts';
import type { LoadedDefinition, Workspace } from '$lib/definitions/types';

const SOURCES: DefinitionDocument[] = [incidentManagement, birthRegistrationAbroad];

/** Every definition, validated and publish-checked, grouped by owning namespace. */
export function loadWorkspaces(): Workspace[] {
	const byNamespace = new Map<string, LoadedDefinition[]>();
	for (const document of SOURCES) {
		const check = checkPublish(document);
		const loaded: LoadedDefinition = {
			document,
			ok: check.ok,
			errors: check.errors,
			issues: check.issues
		};
		const list = byNamespace.get(document.namespace) ?? [];
		list.push(loaded);
		byNamespace.set(document.namespace, list);
	}
	return [...byNamespace]
		.map(([namespace, definitions]) => ({
			namespace,
			label: namespaceLabel(namespace),
			definitions
		}))
		.sort((a, b) => a.label.localeCompare(b.label));
}

/** "acme/eng/sre" reads as "SRE", "personal/example-user/family" as "Family". */
function namespaceLabel(namespace: string): string {
	const last = namespace.split('/').at(-1) ?? namespace;
	const words = last.split('-');
	if (words.length === 1 && last.length <= 3) return last.toUpperCase();
	const text = words.join(' ');
	return text.charAt(0).toUpperCase() + text.slice(1);
}
