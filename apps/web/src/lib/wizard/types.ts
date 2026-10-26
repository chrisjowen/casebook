/**
 * What the page receives about a spreadsheet import. Types only: the wizard agent itself runs on
 * the server, so nothing of `@casebook/wizard-agent` reaches the browser.
 */
import type { DefinitionDocument } from '@casebook/model';
import type { LiveItem, WizardState } from '@casebook/wizard-agent';

export type {
	ChatEntry,
	LiveItem,
	ProposedProcess,
	Turn,
	WizardProcess,
	WizardState
} from '@casebook/wizard-agent';

/** One line of a proposal's diff. */
export interface ProposalChange {
	kind: 'added' | 'changed' | 'removed' | 'reordered';
	summary: string;
	nodeId?: string;
}

/**
 * A pending agent proposal on the open process, as it applies to the draft now: the board shows
 * `document` with `marks`, and Accept saves it against `revision`.
 */
export type ProposalPreview =
	| {
			ok: true;
			processKey: string;
			turnId: string;
			revision: number;
			document: DefinitionDocument;
			changes: ProposalChange[];
			marks: Record<string, 'new' | 'changed'>;
			/** Publish checks the draft would fail with the proposal accepted. */
			blocking: string[];
	  }
	| { ok: false; processKey: string; turnId: string; reason: string };

export interface WizardView {
	id: string;
	version: number;
	fileName: string;
	namespaceId: string;
	/** The chat model the assistant runs on, as `provider:model`. */
	model: string;
	state: WizardState;
	/** Where each proposed process, shared set (`shared:<n>`) or created process comes from. */
	ranges: Record<string, string[]>;
	preview?: ProposalPreview;
	/** A turn of the assistant running or waiting on this import, if any. */
	progress?: RunProgress;
	/** How long one turn may run before the server stops it. */
	timeoutSeconds: number;
}

/** What a running or waiting turn is doing, and what the assistant has written so far. */
export interface RunProgress {
	activity: string;
	waiting: boolean;
	seconds: number;
	text: string;
	items: LiveItem[];
}

/** An import the signed-in person started in the open workspace. */
export interface ImportSummary {
	id: string;
	fileName: string;
	/** ISO 8601. */
	updatedAt: string;
	processes: number;
}

/** A request to the import's endpoint. */
export type WizardAction =
	| { action: 'split' }
	| { action: 'reply'; text: string; processKey?: string }
	| { action: 'rename'; key: string; title: string }
	| { action: 'merge'; from: string; into: string }
	| { action: 'split-off'; key: string; index: number }
	| { action: 'accept-split' }
	| { action: 'draft'; key: string }
	| { action: 'accept'; turnId: string; baseRevision: number }
	| { action: 'reject'; turnId: string }
	| { action: 'publish'; key: string; baseRevision: number };
