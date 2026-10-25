/**
 * The editor's edits as node operations (ADR 0019). Each builder returns the operations for one
 * gesture on the board, saved as one draft revision, with a plain-language label for its notice
 * and the node to select afterwards. A link between steps is never stored: B comes after A because
 * B needs a fact A records (ADR 0003), so every linking gesture is a `requires` or `collects` edit.
 */
import type {
	DefinitionDocument,
	FactId,
	FactNode,
	FactSchema,
	Guard,
	Node,
	NodeId,
	NodeKind,
	Operation,
	RoleId,
	StageId
} from '@casebook/model';
import { nodeReferences } from '@casebook/model';
import {
	collectsOf,
	indexDocument,
	labelOf,
	requiresOf,
	type FactGlyph,
	type HandOff,
	type ProcessIndex,
	type WorkItem
} from '$lib/graph/derive';

export interface Edit {
	ops: Operation[];
	/** What the edit did, in plain words, for the notice that offers Undo. */
	label: string;
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

function workItem(ix: ProcessIndex, id: string): WorkItem {
	const node = ix.byId.get(id);
	if (node?.core.kind !== 'step' && node?.core.kind !== 'decision') {
		throw new Error(`${id} is not a step or decision`);
	}
	return node as WorkItem;
}

/** Kinds a person can pick when making a fact in place. */
export const FACT_KINDS: { label: string; glyph: FactGlyph; schema: FactSchema }[] = [
	{ label: 'Text', glyph: 'text', schema: { type: 'string' } },
	{ label: 'Number', glyph: 'number', schema: { type: 'number' } },
	{ label: 'Yes or no', glyph: 'yesno', schema: { type: 'boolean' } },
	{ label: 'Date', glyph: 'date', schema: { type: 'string', format: 'date' } },
	{ label: 'Choice', glyph: 'choice', schema: { type: 'string', enum: ['Option 1', 'Option 2'] } },
	{
		label: 'People',
		glyph: 'people',
		schema: { type: 'array', items: { type: 'string' }, 'x-lookup': { kind: 'principal' } }
	},
	{
		label: 'Document',
		glyph: 'document',
		schema: { type: 'string', 'x-evidence': { description: 'Upload', formats: ['pdf'] } }
	}
];

export interface NewWork {
	kind: 'step' | 'decision';
	title: string;
	stage: StageId;
	/** Defaults to the definition's first role. */
	role?: RoleId;
	requires?: FactId[];
	when?: Guard;
}

/**
 * A named step, or a named decision with a Yes/No outcome fact, optionally needing facts and
 * guarded. Naming comes first, so adding and naming is one edit and one undo.
 */
export function addWork(document: DefinitionDocument, w: NewWork): Edit & { id: string } {
	const ix = indexDocument(document);
	const title = w.title.trim() || (w.kind === 'decision' ? 'New decision' : 'New step');
	const role = w.role ?? (ix.roles[0]?.core.id as RoleId);
	const id = freshId(document, w.kind, title);
	const common = {
		id,
		title,
		stage: w.stage,
		role,
		actor: 'human' as const,
		...(w.requires?.length ? { requires: w.requires } : {}),
		...(w.when ? { when: w.when } : {})
	};
	const ops: Operation[] = [];
	if (w.kind === 'decision') {
		const outcome = freshId(document, 'fact', `${title} outcome`);
		ops.push({
			op: 'add_node',
			node: {
				core: {
					id: outcome,
					kind: 'fact',
					title: `${title} outcome`,
					schema: { type: 'string', enum: ['Yes', 'No'] }
				}
			}
		});
		ops.push({ op: 'add_node', node: { core: { ...common, kind: 'decision', outcome } } as Node });
	} else {
		ops.push({ op: 'add_node', node: { core: { ...common, kind: 'step' } } as Node });
	}
	const needs = w.requires?.length
		? `, needing ${w.requires.map((f) => labelOf(ix, f)).join(', ')}`
		: '';
	return {
		id,
		ops,
		label: `Added ${title} to ${labelOf(ix, w.stage)}${needs}`,
		select: id
	};
}

/** A named stage, last in order. */
export function addStage(document: DefinitionDocument, title: string): Edit & { id: StageId } {
	const name = title.trim() || 'New stage';
	const id = freshId(document, 'stage', name);
	return {
		id,
		ops: [{ op: 'add_node', node: { core: { id, kind: 'stage', title: name } } }],
		label: `Added stage ${name}`
	};
}

/** A new standing role. */
export function addRole(document: DefinitionDocument, title = 'New role'): Edit & { id: RoleId } {
	const id = freshId(document, 'role', title);
	return {
		id,
		ops: [{ op: 'add_node', node: { core: { id, kind: 'role', title, scope: 'namespace' } } }],
		label: `Added role ${title}`
	};
}

/** Sets a node's title. */
export const rename = (id: string, title: string): Operation => ({
	op: 'update_core',
	id: id as NodeId,
	changes: { title }
});

/**
 * Renames a node. A decision's outcome named after the decision follows the new name, so the
 * outcome never keeps a stale "New decision outcome".
 */
export function renameNode(ix: ProcessIndex, id: string, title: string): Edit {
	const ops = [rename(id, title)];
	const node = ix.byId.get(id);
	if (node?.core.kind === 'decision') {
		const outcome = node.core.outcome;
		if (labelOf(ix, outcome) === `${labelOf(ix, id)} outcome`) {
			ops.push(rename(outcome, `${title} outcome`));
		}
	}
	return { ops, label: `Renamed ${labelOf(ix, id)} to ${title}` };
}

/** The fact already called `title`, ignoring case, so typing a name never makes a duplicate. */
export function factByTitle(ix: ProcessIndex, title: string): FactNode | undefined {
	const wanted = title.trim().toLowerCase();
	return ix.facts.find((f) => labelOf(ix, f.core.id).toLowerCase() === wanted);
}

/** A new fact type, recorded by `collector` and needed by `needers`. */
export function newFact(
	document: DefinitionDocument,
	title: string,
	schema: FactSchema,
	{ collector, needers = [] }: { collector?: string; needers?: string[] }
): Edit & { id: FactId } {
	const ix = indexDocument(document);
	const id = freshId(document, 'fact', title);
	const ops: Operation[] = [
		{ op: 'add_node', node: { core: { id, kind: 'fact', title, schema } } }
	];
	if (collector) ops.push({ op: 'link', from: collector as NodeId, edge: 'collects', to: id });
	for (const n of needers) ops.push({ op: 'link', from: n as NodeId, edge: 'requires', to: id });
	const parts = [
		collector && `${labelOf(ix, collector)} records ${title}`,
		needers.length &&
			`${needers.map((n) => labelOf(ix, n)).join(', ')} needs ${collector ? 'it' : title}`
	].filter(Boolean);
	return { id, ops, label: parts.join('; ') || `Added fact ${title}` };
}

export function setNeeds(ix: ProcessIndex, item: string, fact: FactId, on: boolean): Edit {
	return {
		ops: [{ op: on ? 'link' : 'unlink', from: item as NodeId, edge: 'requires', to: fact }],
		label: on
			? `${labelOf(ix, item)} now needs ${labelOf(ix, fact)}`
			: `${labelOf(ix, item)} no longer needs ${labelOf(ix, fact)}`
	};
}

export function setCollects(ix: ProcessIndex, item: string, fact: FactId, on: boolean): Edit {
	return {
		ops: [{ op: on ? 'link' : 'unlink', from: item as NodeId, edge: 'collects', to: fact }],
		label: on
			? `${labelOf(ix, item)} now records ${labelOf(ix, fact)}`
			: `${labelOf(ix, item)} no longer records ${labelOf(ix, fact)}`
	};
}

/** Which of a step's lists a fact goes in: what it records, or what it needs first. */
export type FactList = 'records' | 'needs';

/**
 * Adds a fact to a step's list by name: an existing fact of that name is reused, otherwise a new
 * one of `schema` is made. Returns the reason instead when the step already has it.
 */
export function addFactByName(
	ix: ProcessIndex,
	item: string,
	list: FactList,
	title: string,
	schema: FactSchema
): Edit | string {
	const work = workItem(ix, item);
	const name = title.trim();
	const existing = factByTitle(ix, name);
	if (existing) {
		const fact = existing.core.id;
		const has =
			list === 'records'
				? collectsOf(work).some((c) => c.fact === fact)
				: requiresOf(work).includes(fact);
		if (has) {
			return `${labelOf(ix, item)} already ${list === 'records' ? 'records' : 'needs'} ${labelOf(ix, fact)}`;
		}
		return list === 'records' ? setCollects(ix, item, fact, true) : setNeeds(ix, item, fact, true);
	}
	return newFact(
		ix.document,
		name,
		schema,
		list === 'records' ? { collector: item } : { needers: [item] }
	);
}

/**
 * Takes a fact off a step's list with one click. A fact nothing else refers to goes away entirely
 * rather than lingering unused.
 */
export function removeFromList(ix: ProcessIndex, item: string, list: FactList, fact: FactId): Edit {
	workItem(ix, item);
	const entry = list === 'records' ? 'collects' : 'requires';
	const used = ix.document.nodes.some((n) =>
		nodeReferences(n).some((r) => r.target === fact && !(n.core.id === item && r.at[1] === entry))
	);
	if (!used) return { ...(removeFact(ix, fact) as Edit), label: `Removed ${labelOf(ix, fact)}` };
	return list === 'records' ? setCollects(ix, item, fact, false) : setNeeds(ix, item, fact, false);
}

/** Changes a fact's kind to one of `FACT_KINDS`, clearing what the old kind needed. */
export function setFactKind(ix: ProcessIndex, fact: FactId, kind: number): Edit {
	const node = ix.byId.get(fact) as FactNode;
	const next = FACT_KINDS[kind];
	const changes: Record<string, unknown> = { ...next.schema };
	for (const key of Object.keys(node.core.schema)) if (!(key in next.schema)) changes[key] = null;
	return {
		ops: [{ op: 'update_core', id: fact, changes: { schema: changes } }],
		label: `${labelOf(ix, fact)} is now ${next.label}`
	};
}

/** Sets the choices of a choice fact, such as a decision's outcome. */
export function setChoices(ix: ProcessIndex, fact: FactId, choices: string[]): Edit {
	return {
		ops: [{ op: 'update_core', id: fact, changes: { schema: { enum: choices } } }],
		label: `Choices for ${labelOf(ix, fact)}: ${choices.join(', ')}`
	};
}

/**
 * Drawing a link from `from` onto `to`: `to` now needs what `from` records that it does not yet
 * need. Undefined when there is nothing to hand over yet.
 */
export function linkWork(ix: ProcessIndex, from: string, to: string): Edit | undefined {
	const source = workItem(ix, from);
	const target = workItem(ix, to);
	const offered = collectsOf(source)
		.map((c) => c.fact)
		.filter((f) => !requiresOf(target).includes(f));
	if (offered.length === 0) return undefined;
	return {
		ops: offered.map((f) => setNeeds(ix, to, f, true).ops[0]),
		label: `${labelOf(ix, to)} now needs ${offered.map((f) => labelOf(ix, f)).join(', ')} from ${labelOf(ix, from)}`
	};
}

/** Removing a drawn link: the later step stops needing what the earlier one hands over. */
export function unlinkHandOff(ix: ProcessIndex, h: HandOff): Edit {
	return {
		ops: h.facts.map((f) => setNeeds(ix, h.to, f, false).ops[0]),
		label: `${labelOf(ix, h.to)} no longer waits for ${labelOf(ix, h.from)}`
	};
}

/** Names a decision's outcome by the decision when it has one: "Approve the release". */
export function outcomeName(ix: ProcessIndex, outcome: string): string {
	const decision = ix.work.find((w) => w.core.kind === 'decision' && w.core.outcome === outcome);
	return labelOf(ix, decision?.core.id ?? outcome);
}

/** The guard for "runs only when `outcome` is `choice`", in prose and as an expression. */
export function branchGuard(ix: ProcessIndex, outcome: string, choice: string): Guard {
	return {
		text: `Only when ${outcomeName(ix, outcome)} is ${choice}`,
		expr: `${outcome} == '${choice.replaceAll("'", "\\'")}'`
	};
}

/** Which choice of `outcome` a work item runs for, when its guard is one `branchGuard` wrote. */
export function branchOf(item: WorkItem, outcome: string): string | undefined {
	const expr = item.core.when?.expr;
	if (!expr || !expr.startsWith(`${outcome} == '`) || !expr.endsWith("'")) return undefined;
	return expr.slice(outcome.length + 5, -1).replaceAll("\\'", "'");
}

/** Linking a decision's choice to a step: the step needs the outcome and runs only for that choice. */
export function branchTo(ix: ProcessIndex, decision: string, choice: string, to: string): Edit {
	const d = workItem(ix, decision);
	if (d.core.kind !== 'decision') throw new Error(`${decision} is not a decision`);
	const outcome = d.core.outcome;
	const target = workItem(ix, to);
	const ops: Operation[] = [];
	if (!requiresOf(target).includes(outcome)) ops.push(setNeeds(ix, to, outcome, true).ops[0]);
	ops.push(setWhen(to, branchGuard(ix, outcome, choice)));
	return {
		ops,
		label: `${labelOf(ix, to)} runs only when ${labelOf(ix, decision)} is ${choice}`
	};
}

export function setWhen(id: string, when: Guard | null): Operation {
	return { op: 'update_core', id: id as NodeId, changes: { when } };
}

export function moveToStage(ix: ProcessIndex, id: string, stage: StageId): Edit {
	return {
		ops: [{ op: 'move_to_stage', id: id as NodeId<'step'>, stage }],
		label: `Moved ${labelOf(ix, id)} to ${labelOf(ix, stage)}`
	};
}

/** Moves a stage one place left or right. Returns the reason when it is already at that end. */
export function shiftStage(ix: ProcessIndex, id: string, by: -1 | 1): Edit | string {
	const order = ix.stages.map((s) => s.core.id);
	const at = order.indexOf(id as StageId);
	if (at < 0) return `${id} is not a stage`;
	if ((by < 0 && at === 0) || (by > 0 && at === order.length - 1)) {
		return `${labelOf(ix, id)} is already the ${by < 0 ? 'first' : 'last'} stage`;
	}
	const before = by < 0 ? order[at - 1] : (order[at + 2] ?? null);
	return {
		ops: [{ op: 'move_stage', id: id as StageId, before: before as StageId | null }],
		label: `Moved stage ${labelOf(ix, id)} ${by < 0 ? 'left' : 'right'}`
	};
}

/** Deletes a step or decision, and the approval only it uses. Facts it recorded stay. */
export function removeWork(ix: ProcessIndex, id: string): Edit {
	const item = workItem(ix, id);
	const ops: Operation[] = [];
	if (item.core.kind === 'step' && item.core.approval) {
		ops.push({ op: 'unlink', from: id as NodeId, edge: 'approval', to: item.core.approval });
		ops.push({ op: 'remove_node', id: item.core.approval });
	}
	ops.push({ op: 'remove_node', id: id as NodeId });
	return { ops, label: `Deleted ${labelOf(ix, id)}` };
}

/** Deletes a stage; its steps move to the neighbouring stage first. */
export function removeStage(ix: ProcessIndex, id: string): Edit | string {
	const at = ix.stages.findIndex((s) => s.core.id === id);
	const items = ix.work.filter((w) => w.core.stage === id);
	const into = ix.stages[at - 1] ?? ix.stages[at + 1];
	if (items.length && !into) return 'A process needs a stage for its steps; add another first.';
	const ops: Operation[] = items.map((w) => ({
		op: 'move_to_stage' as const,
		id: w.core.id as NodeId<'step'>,
		stage: into!.core.id as StageId
	}));
	ops.push({ op: 'remove_node', id: id as NodeId });
	return {
		ops,
		label: items.length
			? `Deleted stage ${labelOf(ix, id)} and moved its ${items.length === 1 ? 'step' : `${items.length} steps`} to ${labelOf(ix, into!.core.id)}`
			: `Deleted stage ${labelOf(ix, id)}`
	};
}

/**
 * Deletes a fact off every step that records or needs it. Returns the reason instead when
 * something else uses it: a decision's outcome goes only with its decision, and a rule, evidence
 * or assignment reading it has to change first.
 */
export function removeFact(ix: ProcessIndex, id: FactId): Edit | string {
	const outcomeOf = ix.work.find((w) => w.core.kind === 'decision' && w.core.outcome === id);
	if (outcomeOf) {
		return `${labelOf(ix, id)} is what ${labelOf(ix, outcomeOf.core.id)} decides; delete the decision instead`;
	}
	const users = ix.document.nodes.filter(
		(n) =>
			n.core.id !== id &&
			nodeReferences(n).some(
				(r) => r.target === id && r.at[1] !== 'collects' && r.at[1] !== 'requires'
			)
	);
	if (users.length) {
		return `${labelOf(ix, id)} is still used by ${users.map((n) => labelOf(ix, n.core.id)).join(', ')}; change that first`;
	}
	const ops: Operation[] = [];
	for (const w of ix.work) {
		if (w.core.kind === 'step' && w.core.collects?.some((c) => c.fact === id)) {
			ops.push({ op: 'unlink', from: w.core.id, edge: 'collects', to: id });
		}
		if (requiresOf(w).includes(id))
			ops.push({ op: 'unlink', from: w.core.id, edge: 'requires', to: id });
	}
	for (const a of ix.approvals) {
		if (requiresOf(a).includes(id))
			ops.push({ op: 'unlink', from: a.core.id, edge: 'requires', to: id });
	}
	ops.push({ op: 'remove_node', id });
	return { ops, label: `Deleted fact ${labelOf(ix, id)}` };
}

/**
 * "+" on a link: a named step between source and target. It needs what the link carried and
 * records a new fact, which the old target now also needs.
 */
export function insertBetween(document: DefinitionDocument, h: HandOff, title: string): Edit {
	const ix = indexDocument(document);
	const target = workItem(ix, h.to);
	const added = addWork(document, {
		kind: 'step',
		title,
		stage: target.core.stage,
		role: target.core.role,
		requires: h.facts
	});
	const named = title.trim() || 'New step';
	const name = `${named} result`;
	const fact = freshId(document, 'fact', name);
	return {
		ops: [
			...added.ops,
			{
				op: 'add_node',
				node: { core: { id: fact, kind: 'fact', title: name, schema: { type: 'string' } } }
			},
			{ op: 'link', from: added.id as NodeId, edge: 'collects', to: fact },
			{ op: 'link', from: h.to as NodeId, edge: 'requires', to: fact }
		],
		label: `Put ${named} between ${labelOf(ix, h.from)} and ${labelOf(ix, h.to)}`,
		select: added.id
	};
}

/** Turns on an approval for a step: an approval by another role, of what the step records. */
export function addApproval(document: DefinitionDocument, stepId: string): Edit {
	const ix = indexDocument(document);
	const step = workItem(ix, stepId);
	const id = freshId(document, 'approval', `approve ${labelOf(ix, stepId)}`);
	const role =
		(ix.roles.find((r) => r.core.id !== step.core.role)?.core.id as RoleId) ?? step.core.role;
	return {
		ops: [
			{
				op: 'add_node',
				node: {
					core: {
						id,
						kind: 'approval',
						title: `Approve ${labelOf(ix, stepId)}`,
						role,
						actor: 'human',
						requires: collectsOf(step).map((c) => c.fact)
					}
				}
			},
			{ op: 'link', from: stepId as NodeId, edge: 'approval', to: id }
		],
		label: `${labelOf(ix, stepId)} now needs approval`
	};
}

export function removeApproval(ix: ProcessIndex, stepId: string): Edit | undefined {
	const step = workItem(ix, stepId);
	const approval = step.core.kind === 'step' ? step.core.approval : undefined;
	if (!approval) return undefined;
	return {
		ops: [
			{ op: 'unlink', from: stepId as NodeId, edge: 'approval', to: approval },
			{ op: 'remove_node', id: approval }
		],
		label: `${labelOf(ix, stepId)} no longer needs approval`
	};
}

/** A copy of a step or decision in the same stage, with "(copy)" added and no approval. */
export function duplicate(document: DefinitionDocument, id: string): Edit {
	const ix = indexDocument(document);
	const node = structuredClone(workItem(ix, id)) as WorkItem;
	const title = `${labelOf(ix, id)} (copy)`;
	(node.core as { id: string }).id = freshId(document, node.core.kind, title);
	node.core.title = title;
	if (node.core.kind === 'step') delete node.core.approval;
	return {
		ops: [{ op: 'add_node', node }],
		label: `Duplicated ${labelOf(ix, id)}`,
		select: node.core.id
	};
}
