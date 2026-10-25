<script lang="ts">
	import { BaseEdge, getSmoothStepPath, type EdgeProps } from '@xyflow/svelte';
	import { roundedPath } from './route';
	let { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps =
		$props();
	const points = $derived((data as { points?: { x: number; y: number }[] } | undefined)?.points);
	const dim = $derived(!!(data as { dim?: boolean } | undefined)?.dim);
	const path = $derived(
		points?.length
			? roundedPath(points)
			: getSmoothStepPath({
					sourceX,
					sourceY,
					targetX,
					targetY,
					sourcePosition,
					targetPosition,
					borderRadius: 10,
					offset: 14
				})[0]
	);
</script>

<BaseEdge
	{id}
	{path}
	style="stroke: var(--brand); stroke-opacity: {dim ? 0.12 : 0.4}; stroke-width: 1.25;"
/>
