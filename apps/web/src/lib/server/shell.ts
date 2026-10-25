/**
 * What the app shell needs on every page of an instance: its processes for the sidebar and the
 * palette, the workspaces a new process or an import can go in, and imports to carry on with.
 */
import { can, listDefinitions, type Actor } from '@casebook/store';
import type { ShellData } from '$lib/shell/types';
import { getDb } from './db';
import { namespaceLabel } from './definitions';
import { listImports } from './wizard';

export async function loadShell(actor: Actor, instanceSlug: string): Promise<ShellData> {
	const namespaces = (await listDefinitions(getDb(), actor)).filter(
		(n) => n.namespace.accountSlug === instanceSlug
	);
	const spaces = namespaces.map(({ namespace, can }) => ({
		id: namespace.id,
		namespace: namespace.path,
		label: namespaceLabel(namespace.path),
		// The store's reason names roles and namespaces; the shell says it in plain words.
		canCreate: can.create.allowed
			? can.create
			: {
					allowed: false,
					reason: 'You can view processes here, not create them'
				}
	}));
	const processes = namespaces.flatMap(({ namespace, definitions }) =>
		definitions.flatMap((d) => {
			const document = (d.published ?? d.draft)?.document;
			if (!document) return [];
			return [
				{
					id: d.id,
					slug: d.slug,
					namespace: namespace.path,
					title: document.nodes.find((x) => x.core.kind === 'process')?.core.title ?? d.slug,
					status: d.published ? ('published' as const) : ('draft' as const),
					draftPending: Boolean(d.published && d.draft && d.changes.length > 0),
					canEdit: d.can.edit
				}
			];
		})
	);
	// New case is open when there is a published process the user may start (ADR 0022).
	let startable = false;
	for (const { definitions } of namespaces) {
		for (const d of definitions) {
			if (startable || !d.published) continue;
			startable = (
				await can(getDb(), actor, 'case.start', { type: 'definition', definitionId: d.id })
			).allowed;
		}
	}
	const canStart = startable
		? { allowed: true, reason: '' }
		: { allowed: false, reason: 'You can follow cases here, not start them' };
	const imports = (
		await Promise.all(
			spaces
				.filter((s) => s.canCreate.allowed)
				.map(async (s) =>
					(await listImports(actor, s.id)).map((i) => ({ ...i, namespace: s.namespace }))
				)
		)
	)
		.flat()
		.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	return { processes, spaces, imports, canStart };
}
