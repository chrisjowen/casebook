/**
 * Process-definition types (ADRs 0002 to 0006). These mirror
 * `schema/process-definition.schema.json`, which is what `validate` enforces; the tests check that
 * both accept the same fixtures and declare the same fields.
 *
 * Every element of a definition is a node with a typed `core`, Markdown `content` and a
 * namespaced `data` map. Edges live in each node's core; the graph is derived.
 */

/** Version of the process-definition schema these types describe. */
export const SCHEMA_VERSION = 1;

export const NODE_KINDS = [
	'process',
	'stage',
	'step',
	'fact',
	'role',
	'decision',
	'approval',
	'lookup'
] as const;

export type NodeKind = (typeof NODE_KINDS)[number];

/** Node identifiers are prefixed with their kind, for example `step.form-working-group`. */
export type NodeId<K extends NodeKind = NodeKind> = `${K}.${string}`;

export type ProcessId = NodeId<'process'>;
export type StageId = NodeId<'stage'>;
export type StepId = NodeId<'step'>;
export type FactId = NodeId<'fact'>;
export type RoleId = NodeId<'role'>;
export type DecisionId = NodeId<'decision'>;
export type ApprovalId = NodeId<'approval'>;
export type LookupId = NodeId<'lookup'>;

/** Who may perform the work. Agents cannot complete `human` work (ADR 0009). */
export const ACTOR_POLICIES = ['human', 'agent', 'either'] as const;

export type ActorPolicy = (typeof ACTOR_POLICIES)[number];

/** A condition stated in prose, with an optional expression in a small safe language (ADR 0004). */
export interface Guard {
	text: string;
	expr?: string;
}

/** Where a node came from in its source material, and whether it was inferred rather than stated. */
export interface SourceRef {
	/** The source document, such as a runbook or spreadsheet file name. */
	doc: string;
	/** A location inside the document, such as a heading anchor or a cell reference. */
	ref?: string;
	inferred: boolean;
}

/** A rule a node must always satisfy, stated in prose. */
export interface Invariant {
	text: string;
}

/** Proof required to back a fact or complete a step. */
export interface EvidenceRequirement {
	description: string;
	/** Acceptable forms, such as `pdf`, `scan` or `certified-copy`. */
	formats?: string[];
	copies?: number;
}

export const LOOKUP_KINDS = ['dataset', 'principal', 'fact', 'case', 'lookup'] as const;

export type LookupKind = (typeof LOOKUP_KINDS)[number];

/** Where a fact's value is chosen from (ADR 0006). */
export type Lookup =
	| { kind: 'dataset'; dataset: string; version?: string }
	| { kind: 'principal'; role?: RoleId }
	| { kind: 'fact'; fact: FactId }
	| { kind: 'case'; process?: string }
	| { kind: 'lookup'; lookup: LookupId };

export const SENSITIVITY_LEVELS = ['none', 'personal', 'sensitive'] as const;

/** Personal-data level of a fact's value. */
export type Sensitivity = (typeof SENSITIVITY_LEVELS)[number];

/** A JSON Schema 2020-12 for a fact's value, plus casebook extensions (ADR 0006). */
export interface FactSchema {
	[keyword: string]: unknown;
	'x-lookup'?: Lookup;
	'x-evidence'?: EvidenceRequirement;
	'x-sensitivity'?: Sensitivity;
}

interface CoreBase<K extends NodeKind> {
	id: NodeId<K>;
	kind: K;
	title?: string;
	source?: SourceRef;
	invariants?: Invariant[];
}

export type ProcessCore = CoreBase<'process'>;

export type StageCore = CoreBase<'stage'>;

/** A fact a step records, and the role that records it when not the step's own role. */
export interface Collect {
	fact: FactId;
	by?: RoleId;
}

/** Evidence a step must attach, optionally tied to the fact it backs. */
export interface StepEvidence extends EvidenceRequirement {
	fact?: FactId;
}

/** Binds the principals recorded in `fact` to `role` on the case (ADR 0008). */
export interface RoleAssignment {
	role: RoleId;
	fact: FactId;
}

export interface Repeat {
	until: Guard;
	/** Suggested interval between repetitions, as an ISO 8601 duration such as `PT30M`. */
	every?: string;
}

export interface StepCore extends CoreBase<'step'> {
	stage: StageId;
	role: RoleId;
	actor: ActorPolicy;
	requires?: FactId[];
	collects?: Collect[];
	evidence?: StepEvidence[];
	assigns?: RoleAssignment[];
	when?: Guard;
	repeat?: Repeat;
	approval?: ApprovalId;
}

export interface FactCore extends CoreBase<'fact'> {
	schema: FactSchema;
}

export const ROLE_SCOPES = ['namespace', 'case'] as const;

export type RoleScope = (typeof ROLE_SCOPES)[number];

export interface RoleCore extends CoreBase<'role'> {
	scope?: RoleScope;
}

export interface DecisionCore extends CoreBase<'decision'> {
	stage: StageId;
	role: RoleId;
	actor: ActorPolicy;
	requires?: FactId[];
	/** The fact the decision records; its schema lists the possible outcomes. */
	outcome: FactId;
	when?: Guard;
}

export interface ApprovalCore extends CoreBase<'approval'> {
	role: RoleId;
	actor: ActorPolicy;
	requires?: FactId[];
	when?: Guard;
}

/**
 * One value of a lookup. `value` is what a case stores and a condition compares, and never changes
 * once cases may hold it; `label` is how people read it, when it differs. A turned-off value is no
 * longer offered, but cases that hold it still read correctly.
 */
export interface LookupValue {
	value: string;
	label?: string;
	/** A short code for the value, such as an ISO country code or an insurer's number. */
	code?: string;
	disabled?: boolean;
}

/** A named list of values a choice fact is chosen from, such as severities or document types. */
export interface LookupCore extends CoreBase<'lookup'> {
	values: LookupValue[];
}

export interface CoreByKind {
	process: ProcessCore;
	stage: StageCore;
	step: StepCore;
	fact: FactCore;
	role: RoleCore;
	decision: DecisionCore;
	approval: ApprovalCore;
	lookup: LookupCore;
}

export type NodeCore = CoreByKind[NodeKind];

/** Open extension map keyed by namespace, such as `bpmn.*`, `excel.*`, `ui.*` or `hooks.*`. */
export type NodeData = Record<string, unknown>;

export interface NodeOf<K extends NodeKind> {
	core: CoreByKind[K];
	/** Markdown prose guidance for people. */
	content?: string;
	data?: NodeData;
}

export type ProcessNode = NodeOf<'process'>;
export type StageNode = NodeOf<'stage'>;
export type StepNode = NodeOf<'step'>;
export type FactNode = NodeOf<'fact'>;
export type RoleNode = NodeOf<'role'>;
export type DecisionNode = NodeOf<'decision'>;
export type ApprovalNode = NodeOf<'approval'>;
export type LookupNode = NodeOf<'lookup'>;

export type Node = { [K in NodeKind]: NodeOf<K> }[NodeKind];

/** One version of a process definition: metadata plus its nodes (ADR 0002). */
export interface DefinitionDocument {
	$schema?: string;
	schemaVersion: typeof SCHEMA_VERSION;
	/** Hierarchical owning namespace, such as `acme/eng/sre` (ADR 0007). */
	namespace: string;
	slug: string;
	version: number;
	nodes: Node[];
}
