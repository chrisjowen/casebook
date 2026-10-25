import { guardReferences } from './guard.js';
import type { FactId, Guard, Node, NodeKind } from './node.js';
import type { Segments } from './pointer.js';

export type ReferenceKind = Extract<NodeKind, 'stage' | 'fact' | 'role' | 'approval' | 'lookup'>;

/** A reference from a node's core to another node: one edge of the derived graph. */
export interface NodeReference {
	/** Location of the reference inside the node, such as `core.requires.1`. */
	at: Segments;
	target: string;
	kind: ReferenceKind;
	/** True for a requires edge, which the dependency checks follow. */
	required: boolean;
	/** True when read out of a guard expression rather than a typed field. */
	inGuard: boolean;
}

/** Lists every reference a node's core makes to other nodes, in field order. */
export function nodeReferences(node: Node): NodeReference[] {
	const refs: NodeReference[] = [];
	const add = (at: Segments, target: string, kind: ReferenceKind, required = false) =>
		refs.push({ at: ['core', ...at], target, kind, required, inGuard: false });
	const addGuard = (at: Segments, guard: Guard | undefined) => {
		if (guard?.expr === undefined) return;
		const { facts, roles } = guardReferences(guard.expr);
		const exprAt = ['core', ...at, 'expr'];
		for (const target of facts) {
			refs.push({ at: exprAt, target, kind: 'fact', required: false, inGuard: true });
		}
		for (const target of roles) {
			refs.push({ at: exprAt, target, kind: 'role', required: false, inGuard: true });
		}
	};
	const addRequires = (requires: readonly FactId[] | undefined) =>
		requires?.forEach((fact, i) => add(['requires', i], fact, 'fact', true));

	const { core } = node;
	switch (core.kind) {
		case 'step':
			add(['stage'], core.stage, 'stage');
			add(['role'], core.role, 'role');
			addRequires(core.requires);
			core.collects?.forEach((c, i) => {
				add(['collects', i, 'fact'], c.fact, 'fact');
				if (c.by !== undefined) add(['collects', i, 'by'], c.by, 'role');
			});
			core.evidence?.forEach((e, i) => {
				if (e.fact !== undefined) add(['evidence', i, 'fact'], e.fact, 'fact');
			});
			core.assigns?.forEach((a, i) => {
				add(['assigns', i, 'role'], a.role, 'role');
				add(['assigns', i, 'fact'], a.fact, 'fact');
			});
			if (core.approval !== undefined) add(['approval'], core.approval, 'approval');
			addGuard(['when'], core.when);
			addGuard(['repeat', 'until'], core.repeat?.until);
			break;
		case 'decision':
			add(['stage'], core.stage, 'stage');
			add(['role'], core.role, 'role');
			addRequires(core.requires);
			add(['outcome'], core.outcome, 'fact');
			addGuard(['when'], core.when);
			break;
		case 'approval':
			add(['role'], core.role, 'role');
			addRequires(core.requires);
			addGuard(['when'], core.when);
			break;
		case 'fact': {
			const lookup = core.schema['x-lookup'];
			if (lookup?.kind === 'principal' && lookup.role !== undefined) {
				add(['schema', 'x-lookup', 'role'], lookup.role, 'role');
			}
			if (lookup?.kind === 'fact') {
				add(['schema', 'x-lookup', 'fact'], lookup.fact, 'fact');
			}
			if (lookup?.kind === 'lookup') {
				add(['schema', 'x-lookup', 'lookup'], lookup.lookup, 'lookup');
			}
			break;
		}
	}
	return refs;
}

/** The guards a node's core holds, with where each sits, such as `core.repeat.until`. */
export function nodeGuards(node: Node): { at: Segments; guard: Guard }[] {
	const { core } = node;
	const fields: [Segments, Guard | undefined][] =
		core.kind === 'step'
			? [
					[['when'], core.when],
					[['repeat', 'until'], core.repeat?.until]
				]
			: core.kind === 'decision' || core.kind === 'approval'
				? [[['when'], core.when]]
				: [];
	return fields.flatMap(([at, guard]) => (guard ? [{ at: ['core', ...at], guard }] : []));
}
