import type { DefinitionDocument, InvariantIssue, ValidationError } from '@casebook/model';

/** Whether the signed-in user may do something, with the reason either way. */
export interface Permission {
	allowed: boolean;
	reason: string;
}

/** The latest published version of a definition. */
export interface PublishedInfo {
	version: number;
	/** ISO 8601 timestamp. */
	at: string;
	by: string;
}

/** A definition as the editor receives it: its draft, publish-check results and permissions. */
export interface LoadedDefinition {
	id: string;
	/** The draft head, or the published version when nothing was drafted. */
	document: DefinitionDocument;
	/** True when the document is schema-valid and has no error-severity invariant issues. */
	ok: boolean;
	errors: ValidationError[];
	issues: InvariantIssue[];
	/** Governed definitions publish explicitly; living ones publish every edit. */
	policy: 'governed' | 'living';
	requiresApproval: boolean;
	/** The draft head's revision number; absent when nothing was drafted. */
	revision?: number;
	/** True when undo has an earlier revision to go back to. */
	undoable: boolean;
	published?: PublishedInfo;
	/** One plain-language line per change since the latest published version. */
	changes: string[];
	can: { edit: Permission; publish: Permission };
}

/** The definitions owned by one namespace (ADR 0007). Definition level only: no cases. */
export interface Workspace {
	id: string;
	namespace: string;
	label: string;
	definitions: LoadedDefinition[];
	can: { create: Permission };
}
