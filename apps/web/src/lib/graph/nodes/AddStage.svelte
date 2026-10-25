<script lang="ts">
	// The column after the last stage: click, type the new stage's name and press Enter.
	import type { NodeProps } from '@xyflow/svelte';
	import { Plus } from '@lucide/svelte';
	import { getBoard } from '../board-context.svelte';

	let { id }: NodeProps = $props();
	const { ui, actions } = getBoard();
	let name = $state('');
	const focus = (el: HTMLInputElement) => el.focus();
	async function save(e: KeyboardEvent) {
		e.stopPropagation();
		if (e.key === 'Escape') ui.addingStage = false;
		if (e.key !== 'Enter' || !name.trim()) return;
		if (await actions.addStage(name.trim())) {
			name = '';
			ui.addingStage = false;
		}
	}
</script>

{#if actions.editable}
	<div
		class="flex h-full w-full flex-col items-center gap-2 rounded-[18px] border border-dashed border-foreground/10 px-3 pt-3.5 text-[12.5px] text-muted-foreground"
	>
		{#if ui.addingStage}
			<input
				class="nodrag nopan h-8 w-full rounded-lg bg-background px-2.5 text-[12.5px] text-foreground shadow-xs outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-brand-ring"
				placeholder="Stage name, then Enter"
				id="{id}-name"
				aria-label="New stage name"
				bind:value={name}
				use:focus
				onkeydown={save}
				onblur={() => !name.trim() && (ui.addingStage = false)}
			/>
		{:else}
			<button
				class="nodrag flex h-8 w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg font-medium hover:bg-brand-soft/60 hover:text-foreground"
				onclick={() => (ui.addingStage = true)}><Plus class="size-4" />Add stage</button
			>
		{/if}
	</div>
{/if}
