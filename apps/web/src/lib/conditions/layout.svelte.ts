import { untrack } from 'svelte';

/** How wide the editor's inspector is: wider while any condition is being edited or tested. */
export const inspector = $state({ wide: 0 });

/** Widens the inspector until the returned cleanup runs, such as when an effect ends. */
export function widen() {
	untrack(() => inspector.wide++);
	return () => {
		untrack(() => inspector.wide--);
	};
}
