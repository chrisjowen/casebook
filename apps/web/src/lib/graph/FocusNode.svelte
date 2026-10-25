<script lang="ts">
	// Pans to a node chosen elsewhere (outline, search). The first focus is left to InitialViewport.
	import { useSvelteFlow, useNodesInitialized } from '@xyflow/svelte';
	import { untrack } from 'svelte';

	let { id }: { id?: string } = $props();
	const flow = useSvelteFlow();
	const ready = useNodesInitialized();
	let initial: string | undefined = untrack(() => id);

	$effect(() => {
		const target = id;
		if (!target || !ready.current || target === initial) return;
		initial = undefined;
		untrack(() => {
			if (flow.getNode(target))
				flow.fitView({ nodes: [{ id: target }], duration: 300, maxZoom: 1, padding: 0.8 });
		});
	});
</script>
