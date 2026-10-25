<script lang="ts">
	// A hand-off on the board: the later step needs facts the earlier one records. It runs through
	// the gaps between cards, or over the top of the board when one is in the way. Hovering shows
	// what is handed over and, for someone who can edit, a "+" to put a step in between; clicking
	// opens the link box.
	import { BaseEdge, EdgeLabel, getSmoothStepPath, type EdgeProps } from '@xyflow/svelte';
	import { Plus } from '@lucide/svelte';
	import type { BoardEdgeData } from '../board';
	import { getBoard } from '../board-context.svelte';

	let {
		id,
		sourceX,
		sourceY,
		targetX,
		targetY,
		sourcePosition,
		targetPosition,
		data
	}: EdgeProps & { data?: BoardEdgeData } = $props();
	const { ui, actions } = getBoard();

	let hover = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;
	const enter = () => {
		clearTimeout(timer);
		hover = true;
	};
	const leave = () => {
		timer = setTimeout(() => (hover = false), 120);
	};

	/** A path through `points` with rounded corners, and the middle of its longest run. */
	function rounded(points: { x: number; y: number }[]): [string, number, number] {
		let d = `M ${points[0].x} ${points[0].y}`;
		for (let i = 1; i < points.length - 1; i++) {
			const [a, b, c] = [points[i - 1], points[i], points[i + 1]];
			const r = Math.min(
				10,
				Math.hypot(b.x - a.x, b.y - a.y) / 2,
				Math.hypot(c.x - b.x, c.y - b.y) / 2
			);
			d += ` L ${b.x - Math.sign(b.x - a.x) * r} ${b.y - Math.sign(b.y - a.y) * r}`;
			d += ` Q ${b.x} ${b.y} ${b.x + Math.sign(c.x - b.x) * r} ${b.y + Math.sign(c.y - b.y) * r}`;
		}
		const end = points[points.length - 1];
		d += ` L ${end.x} ${end.y}`;
		let best = -1;
		let mid = points[0];
		for (let i = 1; i < points.length; i++) {
			const len = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
			if (len > best) {
				best = len;
				mid = { x: (points[i].x + points[i - 1].x) / 2, y: (points[i].y + points[i - 1].y) / 2 };
			}
		}
		return [d, mid.x, mid.y];
	}

	const geometry = $derived.by((): [string, number, number] => {
		const r = data?.route;
		const s = { x: sourceX, y: sourceY };
		const t = { x: targetX, y: targetY };
		if (!r) {
			const [path, x, y] = getSmoothStepPath({
				sourceX,
				sourceY,
				targetX,
				targetY,
				sourcePosition,
				targetPosition,
				borderRadius: 12,
				offset: 16
			});
			return [path, x, y];
		}
		if (r.mode === 'after') return rounded([s, { x: r.x1, y: s.y }, { x: r.x1, y: t.y }, t]);
		if (r.mode === 'before') return rounded([s, { x: r.x2, y: s.y }, { x: r.x2, y: t.y }, t]);
		return rounded([
			s,
			{ x: r.x1, y: s.y },
			{ x: r.x1, y: r.top },
			{ x: r.x2, y: r.top },
			{ x: r.x2, y: t.y },
			t
		]);
	});
	const selectedId = $derived(ui.selected);
	const touches = $derived(
		!!selectedId && (data?.handoff.from === selectedId || data?.handoff.to === selectedId)
	);
	const lit = $derived(
		!!ui.highlightFact && !!data?.handoff.facts.includes(ui.highlightFact as never)
	);
	const active = $derived(hover || touches || lit);
	const dim = $derived(!!selectedId && !touches && !hover);
</script>

<BaseEdge
	{id}
	path={geometry[0]}
	interactionWidth={22}
	style="stroke: var(--brand); stroke-opacity: {active
		? 0.95
		: dim
			? 0.18
			: 0.45}; stroke-width: {active ? 1.9 : 1.4};"
	onmouseenter={enter}
	onmouseleave={leave}
/>
<circle
	cx={targetX}
	cy={targetY}
	r="3"
	fill="var(--brand)"
	fill-opacity={active ? 1 : dim ? 0.2 : 0.6}
	class="pointer-events-none"
/>
{#if hover && data}
	<EdgeLabel x={geometry[1]} y={geometry[2]} class="nodrag nopan">
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="flex items-center gap-1 rounded-lg border border-brand-ring bg-popover p-0.5 text-[11px] shadow-sm"
			onmouseenter={enter}
			onmouseleave={leave}
		>
			<button
				class="max-w-52 cursor-pointer truncate rounded-md px-1.5 py-0.5 text-left text-popover-foreground hover:bg-muted"
				title={actions.editable ? 'Change what is handed over' : data.facts.join(', ')}
				onclick={(e) =>
					actions.editable && actions.editHandOff(data.handoff, e.clientX, e.clientY + 12)}
				>{data.branch ? `${data.branch} · ` : ''}{data.facts.join(', ')}</button
			>
			{#if actions.editable}
				<button
					class="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md bg-brand text-white hover:opacity-90"
					aria-label="Put a step in between"
					title="Put a step in between"
					onclick={(e) => actions.insertStep(data.handoff, e.clientX, e.clientY + 12)}
					><Plus class="size-3" /></button
				>
			{/if}
		</div>
	</EdgeLabel>
{/if}
