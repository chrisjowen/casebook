/**
 * The editor's edits as node operations (ADR 0019). Each builder returns the operations for one
 * atomic edit and the node to select afterwards, such as a newly added fact to name.
 */
import type {
	DecisionNode,
	DefinitionDocument,
	FactId,
	Node,
	NodeId,
	NodeKind,
	Operation,
	RoleId,
	StageId,
	StepId,
	StepNode
} from '@casebook/model';

export interface Edit {
	ops: Operation[];
	/** The node to select once the edit is saved, if any. */
	select?: string;
}

/** A new node id of `kind` made from `title`, numbered when already taken. */
export function freshId<K extends NodeKind>(
	document: DefinitionDocument,
	kind: K,
	title: string
): NodeId<K> {
	const taken = new Set(document.nodes.map((n) => n.core.id));
	const base =
		title
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '') || 'new';
	let id = `${kind}.${base}` as NodeId<K>;
	for (let n = 2; taken.has(id); n++) id = `${kind}.${base}-${n}` as NodeId<K>;
	return id;
}

const find = (document: DefinitionDocument, id: string) =>
	document.nodes.find((n) => n.core.id === id);

function workItem(document: DefinitionDocument, id: string): StepNode | DecisionNode {
	const node = find(document, id);
	if (node?.core.kind !== 'step' && node?.core.kind !== 'decision') {
		throw new Error(`${id} is not a step or decision`);
	}
	return node as StepNode | DecisionNode;
}

/** A new step in a stage, done by `role`, or the definition's first role. */
export function addStep(document: DefinitionDocument, stage: StageId, role?: RoleId): Edit {
	const roleId = role ?? (document.nodes.find((n) => n.core.kind === 'role')?.core.id as RoleId);
	const id = freshId(document, 'step', 'New step');
	return {
		ops: [
			{
				op: 'add_node',
				node: {
					core: { id, kind: 'step', title: 'New step', stage, role: roleId, actor: 'human' }
				}
			}
		],
		select: id
	};
}

/** A new step in the same stage and role as `id`. */
export function addStepAfter(document: DefinitionDocument, id: string): Edit {
	const { core } = workItem(document, id);
	return addStep(document, core.stage, core.role);
}

/** A new text fact type that step `id` collects. */
export function addFact(document: DefinitionDocument, id: string): Edit {
	workItem(document, id);
	const fact = freshId(document, 'fact', 'New fact');
	return {
		ops: [
			{
				op: 'add_node',
				node: { core: { id: fact, kind: 'fact', title: 'New fact', schema: { type: 'string' } } }
			},
			{ op: 'link', from: id as NodeId, edge: 'collects', to: fact }
		],
		select: fact
	};
}

/** A condition in prose on step or decision `id`, to be worded in the inspector. */
export function addCondition(document: DefinitionDocument, id: string): Edit {
	const { core } = workItem(document, id);
	return {
		ops: [
			{
				op: 'update_core',
				id: core.id,
				changes: { when: { text: `Only when ${core.title ?? 'this'} is needed` } }
			}
		],
		select: core.id
	};
}

/** A copy of step or decision `id` in the same stage, with a new id and "(copy)" title. */
export function duplicate(document: DefinitionDocument, id: string): Edit {
	const node = workItem(document, id);
	const title = `${node.core.title ?? node.core.id} (copy)`;
	const copy = structuredClone(node) as Node;
	copy.core.id = freshId(document, node.core.kind, title) as StepId;
	copy.core.title = title;
	return { ops: [{ op: 'add_node', node: copy }], select: copy.core.id };
}

/** Removes node `id`; the model refuses while other nodes refer to it. */
export function remove(id: string): Edit {
	return { ops: [{ op: 'remove_node', id: id as NodeId }] };
}

/** A new, empty stage at the end. */
export function addStage(document: DefinitionDocument): Edit {
	const id = freshId(document, 'stage', 'New stage');
	return { ops: [{ op: 'add_node', node: { core: { id, kind: 'stage', title: 'New stage' } } }] };
}

/** A new standing role. */
export function addRole(document: DefinitionDocument): Edit {
	const id = freshId(document, 'role', 'New role');
	return {
		ops: [
			{
				op: 'add_node',
				node: { core: { id, kind: 'role', title: 'New role', scope: 'namespace' } }
			}
		]
	};
}

/** Sets a node's title. */
export const rename = (id: string, title: string): Operation => ({
	op: 'update_core',
	id: id as NodeId,
	changes: { title }
});

/** A fact a step collects or a step or decision requires, added or removed. */
export const factLink = (
	from: string,
	edge: 'collects' | 'requires',
	fact: FactId,
	on: boolean
): Operation => ({ op: on ? 'link' : 'unlink', from: from as NodeId, edge, to: fact });
