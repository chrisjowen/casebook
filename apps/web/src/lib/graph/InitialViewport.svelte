<script lang="ts">
	// Fits the graph, but never below a readable zoom: wide processes open left-aligned and pan right.
	import { useSvelteFlow, useNodesInitialized } from '@xyflow/svelte';
	import { untrack } from 'svelte';

	let {
		minZoom,
		width,
		height,
		focus,
		pad = 40
	}: { minZoom: number; width: number; height: number; focus?: string; pad?: number } = $props();
	const flow = useSvelteFlow();
	const ready = useNodesInitialized();
	let placed = false;

	$effect(() => {
		if (!ready.current || !width || !height) return;
		untrack(place);
	});

	function place() {
		if (placed) return;
		const roots = flow
			.getNodes()
			.filter((n) => !n.parentId)
			.map((n) => n.id);
		if (!roots.length) return;
		placed = true;
		const b = flow.getNodesBounds(roots);
		const fit = Math.min((width - pad * 2) / b.width, (height - pad * 2) / b.height, 1.05);
		const zoom = Math.max(fit, minZoom);
		let x = fit >= minZoom ? (width - b.width * zoom) / 2 - b.x * zoom : pad - b.x * zoom;
		if (focus && fit < minZoom && flow.getNode(focus)) {
			const f = flow.getNodesBounds([focus]);
			const left = f.x * zoom + x;
			const right = (f.x + f.width) * zoom + x;
			if (right > width - pad || left < pad)
				x = Math.min(width / 2 - (f.x + f.width / 2) * zoom, pad - b.x * zoom);
		}
		const y = Math.max(pad, (height - b.height * zoom) / 2) - b.y * zoom;
		flow.setViewport({ x, y, zoom });
	}
</script>
