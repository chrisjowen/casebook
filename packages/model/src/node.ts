/**
 * Placeholder node model types (ADR 0003). Every element of a definition is a node with a
 * typed `core`, Markdown `content` and a namespaced `data` map. These shapes are a starting
 * point and will be tightened alongside the process-definition JSON Schema.
 */

export const NODE_KINDS = [
	'process',
	'stage',
	'step',
	'fact',
	'role',
	'decision',
	'approval'
] as const;

export type NodeKind = (typeof NODE_KINDS)[number];

/** Node identifiers are prefixed with their kind, for example `step.form-working-group`. */
export type NodeId = string;

/** Who may perform a step. */
export const ACTOR_POLICIES = ['human', 'agent', 'either'] as const;

export type ActorPolicy = (typeof ACTOR_POLICIES)[number];

/** A condition stated in prose, with an optional expression in a small safe language (ADR 0004). */
export interface Guard {
	text: string;
	expr?: string;
}

/** Where a node came from in its source material, and whether it was inferred rather than stated. */
export interface SourceRef {
	ref: string;
	inferred: boolean;
}

/** A rule a node must always satisfy, stated in prose. */
export interface Invariant {
	text: string;
}

/** The typed, schema-validated layer of a node. Edges live here; the graph is derived. */
export interface NodeCore {
	id: NodeId;
	kind: NodeKind;
	stage?: NodeId;
	role?: NodeId;
	actor?: ActorPolicy;
	requires?: NodeId[];
	collects?: NodeId[];
	guards?: Guard[];
	source?: SourceRef;
	invariants?: Invariant[];
}

/** Open extension map keyed by namespace, such as `bpmn.*`, `excel.*`, `ui.*` or `hooks.*`. */
export type NodeData = Record<string, unknown>;

export interface Node {
	core: NodeCore;
	/** Markdown prose guidance for people. */
	content?: string;
	data?: NodeData;
}
