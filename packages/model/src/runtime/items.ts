import type {
	ActorPolicy,
	ApprovalId,
	Collect,
	DefinitionDocument,
	FactId,
	FactNode,
	Guard,
	Repeat,
	RoleAssignment,
	RoleId,
	RoleNode,
	StageId,
	StepEvidence,
	StepId
} from '../node.js';

/** The kinds of node someone works on in a case. */
export const WORK_ITEM_KINDS = ['step', 'decision', 'approval'] as const;

export type WorkItemKind = (typeof WORK_ITEM_KINDS)[number];

/**
 * A step, decision or approval as the runtime sees it: one piece of work in one stage, with the
 * facts it reads and records. A decision records its outcome fact. An approval has no stage of
 * its own and sits in the stage of the step it reviews.
 */
export interface WorkItem {
	id: string;
	kind: WorkItemKind;
	title: string;
	stage: StageId;
	role: RoleId;
	actor: ActorPolicy;
	requires: FactId[];
	collects: Collect[];
	evidence: StepEvidence[];
	assigns: RoleAssignment[];
	when?: Guard;
	repeat?: Repeat;
	/** For a step: the approval that reviews it. */
	approval?: ApprovalId;
	/** For an approval: the step it reviews. */
	reviews?: StepId;
	/** For a decision: the fact it records. */
	outcome?: FactId;
	/** Markdown guidance for whoever does the work. */
	content?: string;
}

export interface StageInfo {
	id: StageId;
	title: string;
}

/** What the runtime needs from a definition: its title, stages, work items, facts and roles. */
export interface RunnableProcess {
	title: string;
	summary?: string;
	stages: StageInfo[];
	items: WorkItem[];
	facts: Map<string, FactNode>;
	roles: Map<string, RoleNode['core']>;
}

/**
 * Reads a definition into the shape the runtime works with. Work items come in run order: by
 * stage, each after the items whose facts it needs, and otherwise in document order, with each
 * approval placed right after the step it reviews. An approval no step refers to has no stage, so
 * it is left out.
 */
export function runnableProcess(document: DefinitionDocument): RunnableProcess {
	let title = document.slug;
	let summary: string | undefined;
	const stages: StageInfo[] = [];
	const items: WorkItem[] = [];
	const facts = new Map<string, FactNode>();
	const roles = new Map<string, RoleNode['core']>();
	const approvals = new Map<string, WorkItem>();
	const base = (node: { content?: string }) => (node.content ? { content: node.content } : {});

	for (const node of document.nodes) {
		const { core } = node;
		switch (core.kind) {
			case 'process':
				title = core.title ?? title;
				if (node.content) summary = node.content;
				break;
			case 'stage':
				stages.push({ id: core.id, title: core.title ?? core.id });
				break;
			case 'fact':
				facts.set(core.id, node as FactNode);
				break;
			case 'role':
				roles.set(core.id, core);
				break;
			case 'step':
				items.push({
					id: core.id,
					kind: 'step',
					title: core.title ?? core.id,
					stage: core.stage,
					role: core.role,
					actor: core.actor,
					requires: core.requires ?? [],
					collects: core.collects ?? [],
					evidence: core.evidence ?? [],
					assigns: core.assigns ?? [],
					...(core.when ? { when: core.when } : {}),
					...(core.repeat ? { repeat: core.repeat } : {}),
					...(core.approval ? { approval: core.approval } : {}),
					...base(node)
				});
				break;
			case 'decision':
				items.push({
					id: core.id,
					kind: 'decision',
					title: core.title ?? core.id,
					stage: core.stage,
					role: core.role,
					actor: core.actor,
					requires: core.requires ?? [],
					collects: [{ fact: core.outcome }],
					evidence: [],
					assigns: [],
					outcome: core.outcome,
					...(core.when ? { when: core.when } : {}),
					...base(node)
				});
				break;
			case 'approval':
				approvals.set(core.id, {
					id: core.id,
					kind: 'approval',
					title: core.title ?? core.id,
					// Placeholder until the reviewed step is known.
					stage: '' as StageId,
					role: core.role,
					actor: core.actor,
					requires: core.requires ?? [],
					collects: [],
					evidence: [],
					assigns: [],
					...(core.when ? { when: core.when } : {}),
					...base(node)
				});
				break;
		}
	}

	const ordered: WorkItem[] = [];
	for (const item of runOrder(items, stages)) {
		ordered.push(item);
		const approval = item.approval && approvals.get(item.approval);
		if (approval && approval.reviews === undefined) {
			approval.stage = item.stage;
			approval.reviews = item.id as StepId;
			ordered.push(approval);
		}
	}
	return { title, ...(summary ? { summary } : {}), stages, items: ordered, facts, roles };
}

/**
 * Orders work items by stage, and within that so that an item comes after those recording the
 * facts it needs; ties, and any items caught in a cycle, keep document order.
 */
function runOrder(items: WorkItem[], stages: StageInfo[]): WorkItem[] {
	const stageAt = new Map(stages.map((s, i) => [s.id, i]));
	const rank = (i: number) => stageAt.get(items[i]!.stage) ?? stages.length;
	const recorders = new Map<string, number[]>();
	items.forEach((item, i) => {
		for (const c of item.collects) recorders.set(c.fact, [...(recorders.get(c.fact) ?? []), i]);
	});
	const before = items.map((item, i) => [
		...new Set(item.requires.flatMap((f) => (recorders.get(f) ?? []).filter((r) => r !== i)))
	]);
	const placed = new Set<number>();
	const order: WorkItem[] = [];
	while (placed.size < items.length) {
		let next = -1;
		for (let i = 0; i < items.length; i++) {
			if (placed.has(i) || !before[i]!.every((b) => placed.has(b))) continue;
			if (next < 0 || rank(i) < rank(next)) next = i;
		}
		// A cycle: take the earliest item left, as the document has it.
		if (next < 0) next = items.findIndex((_, i) => !placed.has(i));
		placed.add(next);
		order.push(items[next]!);
	}
	return order;
}

/** The facts a work item records that the given role records, by default the item's own role. */
export function collectedBy(item: WorkItem, role: string = item.role): FactId[] {
	return item.collects.filter((c) => (c.by ?? item.role) === role).map((c) => c.fact);
}
