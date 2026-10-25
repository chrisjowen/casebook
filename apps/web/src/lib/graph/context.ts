import { getContext, setContext } from 'svelte';

/** Edits a step or decision's menu offers. */
export interface NodeEdits {
	addStep: (id: string) => void;
	addFact: (id: string) => void;
	addCondition: (id: string) => void;
	duplicate: (id: string) => void;
	remove: (id: string) => void;
}

/** Actions nodes can trigger from their menu. */
export interface GraphActions {
	inspect: (id: string) => void;
	edits?: NodeEdits;
	/** Why the edits are unavailable, when they are. */
	blocked?: string;
}

const KEY = Symbol('casebook-graph');

export const setGraphActions = (actions: GraphActions) => setContext(KEY, actions);
export const getGraphActions = () => getContext<GraphActions | undefined>(KEY);
