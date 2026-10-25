import type { DefinitionDocument, InvariantIssue, ValidationError } from '@casebook/model';

/** A definition as the editor receives it: the document plus its publish-check results. */
export interface LoadedDefinition {
	document: DefinitionDocument;
	/** True when the document is schema-valid and has no error-severity invariant issues. */
	ok: boolean;
	errors: ValidationError[];
	issues: InvariantIssue[];
}

/** The definitions owned by one namespace (ADR 0007). Definition level only: no cases. */
export interface Workspace {
	namespace: string;
	label: string;
	definitions: LoadedDefinition[];
}
