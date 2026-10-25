import { checkInvariants, type InvariantCode, type InvariantIssue } from '../invariants.js';
import type { Collect, DefinitionDocument, Node, NodeKind } from '../node.js';
import { formatField } from '../pointer.js';
import { nodeReferences } from '../references.js';
import { validate } from '../validate.js';
import { clone, isRecord, mergePatch } from './json.js';
import { reject, type Rejection, type RejectionCode } from './rejection.js';
import {
	checkOperation,
	type EdgeKind,
	type Link,
	type Operation,
	type Unlink
} from './operations.js';

/**
 * Invariant issues that reject an operation outright: broken references and an ambiguous or
 * missing process node. Every other issue is draft incompleteness, such as an uncollected fact,
 * an undeclared role, a guard naming an unknown fact or a dependency cycle. Those come back as
 * warnings and block only at publish, when their severity is `error`.
 */
export const REJECTING_ISSUE_CODES = [
	'duplicate-id',
	'missing-process',
	'multiple-processes',
	'unknown-stage',
	'unknown-fact',
	'unknown-approval'
] as const satisfies readonly InvariantCode[];

const rejecting: ReadonlySet<InvariantCode> = new Set(REJECTING_ISSUE_CODES);

export interface Applied {
	ok: true;
	document: DefinitionDocument;
	/**
	 * Every invariant issue left in the new document. None reject an edit; those with severity
	 * `error` will block publishing until fixed.
	 */
	warnings: InvariantIssue[];
}

export type ApplyResult = Applied | Rejection;

/**
 * Applies one operation to a draft. Returns a new document, sharing unchanged nodes with the input,
 * or a rejection; the input is never modified. The new document must pass schema validation and
 * must not introduce a rejecting invariant issue (`REJECTING_ISSUE_CODES`).
 */
export function apply(document: DefinitionDocument, operation: Operation): ApplyResult {
	return applyBatch(document, [operation]);
}

/**
 * Applies operations in order, as one atomic edit such as an agent turn: every operation is
 * checked against the result of the ones before it, and if any is rejected the whole batch is,
 * with `index` naming the one at fault.
 */
export function applyBatch(
	document: DefinitionDocument,
	operations: readonly Operation[]
): ApplyResult {
	let current = document;
	for (const [index, operation] of operations.entries()) {
		const result = applyOne(current, operation);
		if (!result.ok) return { ...result, operation, ...(operations.length > 1 ? { index } : {}) };
		current = result.document;
	}
	return { ok: true, document: current, warnings: checkInvariants(current) };
}

type Edit = { ok: true; document: DefinitionDocument } | Rejection;

function applyOne(document: DefinitionDocument, operation: unknown): Edit {
	const shape = checkOperation(operation);
	if (!shape.valid) {
		return reject(
			'invalid-operation',
			`The operation is malformed: ${shape.errors.map((e) => e.message).join('; ')}`
		);
	}
	const edit = change(document, shape.operation);
	return edit.ok ? checked(document, edit.document) : edit;
}

function change(document: DefinitionDocument, op: Operation): Edit {
	switch (op.op) {
		case 'add_node':
			return addNode(document, op.node);
		case 'remove_node':
			return removeNode(document, op.id);
		case 'update_core':
			return withNode(document, op.id, (node) => {
				const fixed = ['id', 'kind'].filter((field) => Object.hasOwn(op.changes, field));
				if (fixed.length > 0) {
					return reject(
						'immutable-field',
						`${op.id}: ${fixed.join(' and ')} cannot be changed; add a new node and remove this one instead`
					);
				}
				return { ...node, core: mergePatch(node.core, op.changes) } as Node;
			});
		case 'set_content':
			return withNode(
				document,
				op.id,
				(node) => mergePatch(node, { content: op.content === '' ? null : op.content }) as Node
			);
		case 'set_data':
			return withNode(document, op.id, (node) => {
				// The value replaces the key's current value whole, unlike update_core's merge.
				const data: Record<string, unknown> = { ...node.data };
				if (op.value === null || op.value === undefined) {
					delete data[op.key];
				} else {
					data[op.key] = clone(op.value);
				}
				return Object.keys(data).length > 0
					? { ...node, data }
					: (mergePatch(node, { data: null }) as Node);
			});
		case 'link':
			return link(document, op);
		case 'unlink':
			return unlink(document, op);
		case 'move_to_stage':
			return link(document, { op: 'link', from: op.id, edge: 'stage', to: op.stage });
	}
}

function addNode(document: DefinitionDocument, node: Node): Edit {
	const id: unknown = isRecord(node.core) ? node.core.id : undefined;
	if (typeof id === 'string' && document.nodes.some((n) => n.core.id === id)) {
		return reject(
			'duplicate-id',
			`${id} already exists; choose a new id or change the existing node`
		);
	}
	const kind: unknown = isRecord(node.core) ? node.core.kind : undefined;
	const last = document.nodes.findLastIndex((n) => n.core.kind === kind);
	const at = last === -1 ? document.nodes.length : last + 1;
	return {
		ok: true,
		document: { ...document, nodes: document.nodes.toSpliced(at, 0, clone(node)) }
	};
}

function removeNode(document: DefinitionDocument, id: string): Edit {
	const index = document.nodes.findIndex((n) => n.core.id === id);
	if (index === -1) return unknownNode(id);
	const referrers = document.nodes.flatMap((node, i) => {
		if (i === index) return [];
		const fields = nodeReferences(node)
			.filter((ref) => ref.target === id)
			.map((ref) => formatField(ref.at));
		return fields.length > 0 ? [`${node.core.id} (${[...new Set(fields)].join(', ')})`] : [];
	});
	if (referrers.length > 0) {
		return reject(
			'referenced',
			`${id} cannot be removed while other nodes refer to it: ${referrers.join('; ')}. Change or unlink those references first`
		);
	}
	return { ok: true, document: { ...document, nodes: document.nodes.toSpliced(index, 1) } };
}

/** Which node kinds each edge can start from, and the kind it points to. */
const EDGES: Record<EdgeKind, { from: readonly NodeKind[]; to: NodeKind }> = {
	requires: { from: ['step', 'decision', 'approval'], to: 'fact' },
	collects: { from: ['step'], to: 'fact' },
	approval: { from: ['step'], to: 'approval' },
	stage: { from: ['step', 'decision'], to: 'stage' }
};

function checkEdge(document: DefinitionDocument, op: Link | Unlink): Rejection | undefined {
	const verb = op.op === 'link' ? 'link' : 'unlink';
	const rule = EDGES[op.edge];
	const from = findNode(document, op.from);
	if (from === undefined) return unknownNode(op.from);
	if (!rule.from.includes(from.core.kind)) {
		return reject(
			'wrong-kind',
			`Cannot ${verb} ${op.edge} on ${op.from}: only a ${listKinds(rule.from)} has ${op.edge} edges`
		);
	}
	if (op.op === 'link') {
		const to = findNode(document, op.to);
		if (to === undefined) return unknownNode(op.to);
		if (to.core.kind !== rule.to) {
			return reject(
				'wrong-kind',
				`Cannot link ${op.from} ${op.edge} to ${op.to}: a ${op.edge} edge must point to a ${rule.to}`
			);
		}
		if (op.by !== undefined && op.edge !== 'collects') {
			return reject('invalid-operation', `"by" applies only to collects edges, not ${op.edge}`);
		}
	}
	return undefined;
}

function link(document: DefinitionDocument, op: Link): Edit {
	const invalid = checkEdge(document, op);
	if (invalid !== undefined) return invalid;
	return withNode(document, op.from, (node) => {
		const core = node.core as unknown as Record<string, unknown>;
		const already = reject('no-change', `${op.from} already has ${op.edge} ${op.to}`);
		switch (op.edge) {
			case 'requires': {
				const requires = (core.requires as string[] | undefined) ?? [];
				if (requires.includes(op.to)) return already;
				return withCore(node, { requires: [...requires, op.to] });
			}
			case 'collects': {
				const collects = (core.collects as Collect[] | undefined) ?? [];
				if (collects.some((c) => c.fact === op.to)) return already;
				const collect = op.by === undefined ? { fact: op.to } : { fact: op.to, by: op.by };
				return withCore(node, { collects: [...collects, collect] });
			}
			case 'approval':
			case 'stage':
				if (core[op.edge] === op.to) return already;
				return withCore(node, { [op.edge]: op.to });
		}
	});
}

function unlink(document: DefinitionDocument, op: Unlink): Edit {
	const invalid = checkEdge(document, op);
	if (invalid !== undefined) return invalid;
	return withNode(document, op.from, (node) => {
		const core = node.core as unknown as Record<string, unknown>;
		const missing = reject('not-linked', `${op.from} has no ${op.edge} edge to ${op.to}`);
		switch (op.edge) {
			case 'requires': {
				const requires = (core.requires as string[] | undefined) ?? [];
				if (!requires.includes(op.to)) return missing;
				return withCore(node, { requires: emptyToNull(requires.filter((f) => f !== op.to)) });
			}
			case 'collects': {
				const collects = (core.collects as Collect[] | undefined) ?? [];
				if (!collects.some((c) => c.fact === op.to)) return missing;
				return withCore(node, { collects: emptyToNull(collects.filter((c) => c.fact !== op.to)) });
			}
			case 'approval':
				if (core.approval !== op.to) return missing;
				return withCore(node, { approval: null });
			case 'stage':
				return reject(
					'required-edge',
					`${op.from} must belong to a stage; use move_to_stage to change it`
				);
		}
	});
}

/**
 * Checks a whole document as a starting draft: it must pass the schema and have no rejecting
 * invariant issue.
 */
export function checkDraft(document: DefinitionDocument): ApplyResult {
	const result = checked(undefined, document);
	return result.ok ? { ok: true, document, warnings: checkInvariants(document) } : result;
}

/**
 * Rejects a candidate that fails the schema or has a rejecting invariant issue that `before`
 * did not already have.
 */
function checked(before: DefinitionDocument | undefined, after: DefinitionDocument): Edit {
	const result = validate(after);
	if (!result.valid) {
		const reason = result.errors.map((e) =>
			e.nodeId === undefined ? e.message : `${e.nodeId}: ${e.message}`
		);
		return { ...reject('schema-violation', reason.join('; ')), errors: result.errors };
	}
	const blocking = checkInvariants(after).filter((issue) => rejecting.has(issue.code));
	if (blocking.length === 0) return { ok: true, document: after };
	const existing = new Set(before === undefined ? [] : checkInvariants(before).map(issueKey));
	const introduced = blocking.filter((issue) => !existing.has(issueKey(issue)));
	if (introduced.length === 0) return { ok: true, document: after };
	return {
		...reject(rejectionCode(introduced), introduced.map((i) => i.message).join('; ')),
		issues: introduced
	};
}

function rejectionCode(issues: InvariantIssue[]): RejectionCode {
	if (issues.some((i) => i.code === 'duplicate-id')) return 'duplicate-id';
	if (issues.some((i) => i.code === 'missing-process' || i.code === 'multiple-processes')) {
		return 'process-count';
	}
	return 'broken-reference';
}

/** Identifies an issue across edits, which can move nodes and so change paths. */
function issueKey(issue: InvariantIssue): string {
	return issue.code === 'duplicate-id'
		? `${issue.code} ${issue.nodeId}`
		: `${issue.code} ${issue.nodeId ?? ''} ${issue.message}`;
}

function withNode(
	document: DefinitionDocument,
	id: string,
	update: (node: Node) => Node | Rejection
): Edit {
	const index = document.nodes.findIndex((n) => n.core.id === id);
	const node = document.nodes[index];
	if (node === undefined) return unknownNode(id);
	const updated = update(node);
	if ('ok' in updated) return updated;
	return { ok: true, document: { ...document, nodes: document.nodes.with(index, updated) } };
}

function withCore(node: Node, changes: Record<string, unknown>): Node {
	return { ...node, core: mergePatch(node.core, changes) } as Node;
}

function findNode(document: DefinitionDocument, id: string): Node | undefined {
	return document.nodes.find((n) => n.core.id === id);
}

function emptyToNull<T>(items: T[]): T[] | null {
	return items.length === 0 ? null : items;
}

function unknownNode(id: string): Rejection {
	return reject('unknown-node', `${id} does not exist in this definition`);
}

function listKinds(kinds: readonly string[]): string {
	return kinds.length <= 1
		? (kinds[0] ?? '')
		: `${kinds.slice(0, -1).join(', ')} or ${kinds.at(-1)}`;
}
