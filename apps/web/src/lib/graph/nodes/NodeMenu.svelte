<script lang="ts">
	// Node menu: inspect, plus the edits a step or decision offers. Edits are shown disabled, with
	// the reason, when the signed-in user cannot edit this draft.
	import { SquarePen, Plus, ListPlus, Split, Copy, Trash2 } from '@lucide/svelte';
	import { getGraphActions } from '../context';

	let { id, kind, onclose }: { id: string; kind: 'step' | 'decision'; onclose: () => void } =
		$props();
	const actions = getGraphActions();
	const blocked = $derived(actions?.blocked ?? (actions?.edits ? undefined : 'Editing is off'));
	const items = $derived([
		{ icon: SquarePen, label: 'Inspect', key: 'Enter', run: () => actions?.inspect(id) },
		{ icon: ListPlus, label: 'Add step after', run: () => actions?.edits?.addStep(id), edit: true },
		{
			icon: Plus,
			label: 'Add fact',
			run: () => actions?.edits?.addFact(id),
			edit: true,
			off: kind === 'decision' ? 'A decision records only its outcome' : undefined
		},
		{
			icon: Split,
			label: 'Add condition',
			run: () => actions?.edits?.addCondition(id),
			edit: true
		},
		{ icon: Copy, label: 'Duplicate', run: () => actions?.edits?.duplicate(id), edit: true },
		{
			icon: Trash2,
			label: 'Delete',
			run: () => actions?.edits?.remove(id),
			edit: true,
			danger: true
		}
	]);
</script>

<svelte:window onpointerdown={onclose} onkeydown={(e) => e.key === 'Escape' && onclose()} />
<div
	class="nodrag nowheel absolute top-9 right-2 z-50 w-56 rounded-xl border bg-popover p-1 text-[13px] shadow-lg"
	role="menu"
	tabindex="-1"
	onpointerdown={(e) => e.stopPropagation()}
>
	{#each items as item, i (item.label)}
		{@const disabled = item.edit ? (blocked ?? item.off) : undefined}
		{#if item.danger}<div class="my-1 h-px bg-border"></div>{/if}
		<button
			role="menuitem"
			disabled={!!disabled}
			title={disabled}
			class={[
				'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left',
				disabled ? 'cursor-not-allowed text-muted-foreground/60' : 'cursor-pointer hover:bg-muted',
				!disabled && item.danger && 'text-destructive',
				i === 0 && 'bg-muted'
			]}
			onclick={(e) => {
				e.stopPropagation();
				item.run();
				onclose();
			}}
		>
			<item.icon class="size-4 shrink-0" />{item.label}
			{#if item.key}
				<kbd
					class="ml-auto rounded-md bg-foreground px-1.5 py-px text-[11px] font-medium text-background"
					>{item.key}</kbd
				>
			{/if}
		</button>
	{/each}
	{#if blocked}
		<p class="border-t px-2.5 pt-1.5 pb-1 text-[11px] leading-snug text-muted-foreground">
			{blocked}
		</p>
	{/if}
</div>
