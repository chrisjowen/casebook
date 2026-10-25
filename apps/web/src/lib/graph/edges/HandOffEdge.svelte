<script lang="ts">
	// A hand-off: brand-coloured orthogonal line with diamond ends; hovering shows the facts it carries.
	import { BaseEdge, EdgeLabel, getSmoothStepPath, type EdgeProps } from '@xyflow/svelte';
	import type { HandOffData } from '../layout';
	import { labelPoint, roundedPath } from './route';

	let {
		id,
		sourceX,
		sourceY,
		targetX,
		targetY,
		sourcePosition,
		targetPosition,
		data,
		selected
	}: EdgeProps & { data?: HandOffData } = $props();

	let hover = $state(false);
	const geometry = $derived.by(() => {
		if (data?.points?.length) {
			const at = labelPoint(data.points);
			return {
				path: roundedPath(data.points),
				x: at.x,
				y: at.y,
				ends: [data.points[0], data.points[data.points.length - 1]]
			};
		}
		// lanes turn just after the source column so vertical runs sit in the gap, not behind cards
		const [path, x, y] = getSmoothStepPath({
			sourceX,
			sourceY,
			targetX,
			targetY,
			sourcePosition,
			targetPosition,
			borderRadius: 10,
			offset: 18,
			centerX: data?.lane ? sourceX + 24 : undefined
		});
		return {
			path,
			x,
			y,
			ends: [
				{ x: sourceX, y: sourceY },
				{ x: targetX, y: targetY }
			]
		};
	});
	const active = $derived(hover || selected || !!data?.active);
	const showLabel = $derived((hover || selected || !!data?.alwaysLabel) && !!data?.facts.length);
</script>

<BaseEdge
	{id}
	path={geometry.path}
	interactionWidth={18}
	style="stroke: var(--brand); stroke-opacity: {active
		? 0.95
		: data?.dim
			? 0.12
			: 0.45}; stroke-width: {active ? 1.75 : 1.4};"
	onmouseenter={() => (hover = true)}
	onmouseleave={() => (hover = false)}
/>
{#each geometry.ends as p, i (i)}
	<rect
		x={p.x - 3.5}
		y={p.y - 3.5}
		width="7"
		height="7"
		rx="1.5"
		transform="rotate(45 {p.x} {p.y})"
		fill="var(--brand)"
		fill-opacity={active ? 1 : data?.dim ? 0.15 : 0.6}
		class="pointer-events-none"
	/>
{/each}
{#if showLabel}
	<EdgeLabel x={geometry.x} y={geometry.y} class="pointer-events-none">
		<div
			class="max-w-60 rounded-lg border border-brand-ring bg-popover px-2 py-1 text-[11px] leading-snug text-popover-foreground shadow-sm"
		>
			{#each data?.facts ?? [] as f (f)}<div class="truncate">{f}</div>{/each}
		</div>
	</EdgeLabel>
{/if}
