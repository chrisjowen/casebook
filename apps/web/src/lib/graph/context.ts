import { getContext, setContext } from 'svelte';

/** Read-only actions nodes can trigger from their menu. */
export interface GraphActions {
	inspect: (id: string) => void;
	copyId: (id: string) => void;
}

const KEY = Symbol('casebook-graph');

export const setGraphActions = (actions: GraphActions) => setContext(KEY, actions);
export const getGraphActions = () => getContext<GraphActions | undefined>(KEY);
