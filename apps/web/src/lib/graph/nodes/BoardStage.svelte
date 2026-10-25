<script lang="ts">
	// A stage as a column on the board, shown even when empty. For someone who can edit: rename by
	// double-clicking its name, add with the "+" in its header or the button at its foot, and drop a
	// card on it to move that card here.
	import type { NodeProps } from '@xyflow/svelte';
	import { Plus, EllipsisVertical } from '@lucide/svelte';
	import type { BoardStageData } from '../board';
	import { getBoard, releaseFocus } from '../board-context.svelte';

	let { id, data }: NodeProps & { data: BoardStageData } = $props();
	const { ui, actions } = getBoard();
	const editable = $derived(actions.editable);
	const renaming = $derived(ui.renaming === id);
	const drop = $derived(ui.dropStage === id);
	const focus = (el: HTMLInputElement) => {
		el.focus();
		el.select();
	};
	function commit(e: Event) {
		const value = (e.currentTarget as HTMLInputElement).value.trim();
		if (ui.renaming !== id) return;
		ui.renaming = undefined;
		if (value && value !== data.title) actions.rename(id, value);
	}
	const add = (e: MouseEvent) => {
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
		actions.quickAdd({ x: r.left, y: r.bottom + 6, stage: id });
	};
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class={[
		'relative h-full w-full rounded-[18px] border border-dashed transition-colors duration-150',
		drop
			? 'border-brand bg-brand-soft/60'
			: ui.selected === id
				? 'border-brand-ring bg-brand-soft/30'
				: 'border-foreground/10 bg-foreground/[0.018]'
	]}
	ondblclick={(e) => {
		if (!editable || (e.target as HTMLElement).closest('button,input')) return;
		actions.quickAdd({ x: e.clientX, y: e.clientY, stage: id });
	}}
>
	<div class="flex h-[52px] items-center gap-2 px-4 text-[12.5px]">
		<span
			class="flex size-5 shrink-0 items-center justify-center rounded-md bg-background text-[11px] font-medium text-muted-foreground shadow-xs"
			>{data.index}</span
		>
		{#if renaming}
			<input
				class="nodrag nopan min-w-0 flex-1 rounded-md bg-background px-1.5 py-0.5 font-medium outline-none focus:ring-2 focus:ring-brand-ring"
				value={data.title}
				aria-label="Stage name"
				use:focus
				onblur={commit}
				onkeydown={(e) => {
					e.stopPropagation();
					if (e.key === 'Enter') e.currentTarget.blur();
					if (e.key === 'Escape') ui.renaming = undefined;
				}}
			/>
		{:else}
			<button
				class="nodrag nopan min-w-0 cursor-pointer truncate font-medium text-foreground/85"
				title={editable ? 'Double-click to rename' : undefined}
				onmousedown={releaseFocus}
				onclick={() => actions.select(id)}
				ondblclick={(e) => {
					if (!editable) return;
					e.stopPropagation();
					ui.renaming = id;
				}}>{data.title}</button
			>
			<span class="shrink-0 text-muted-foreground"
				>· {data.count} {data.count === 1 ? 'item' : 'items'}</span
			>
		{/if}
		<span class="flex-1"></span>
		{#if editable}
			<button
				class="nodrag flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground"
				aria-label="Add to {data.title}"
				title="Add a step or decision to this stage"
				onclick={add}><Plus class="size-4" /></button
			>
			<button
				class="nodrag -mr-1.5 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground"
				aria-label="Stage actions for {data.title}"
				onclick={(e) => {
					const r = e.currentTarget.getBoundingClientRect();
					actions.stageMenu(id, r.left, r.bottom + 4);
				}}><EllipsisVertical class="size-4" /></button
			>
		{/if}
	</div>
	{#if data.count === 0}
		<div
			class="pointer-events-none absolute inset-x-4 top-16 flex flex-col items-center gap-1 rounded-xl border border-dashed border-foreground/10 px-3 py-6 text-center text-[12px] text-muted-foreground"
		>
			<span class="font-medium text-foreground/70">Empty stage</span>
			{#if editable}<span>Add a step below, or drag a card here.</span>{/if}
		</div>
	{/if}
	{#if editable}
		<button
			class="nodrag absolute inset-x-4 bottom-3 flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-foreground/15 text-[12px] text-muted-foreground hover:border-brand-ring hover:bg-background hover:text-foreground"
			onclick={add}><Plus class="size-3.5" />Add step</button
		>
	{/if}
</div>
