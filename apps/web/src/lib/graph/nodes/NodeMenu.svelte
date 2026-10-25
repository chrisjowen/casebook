<script lang="ts">
	// Node menu. Inspect and copy work today; editing actions are shown disabled until editing lands.
	import { SquarePen, Plus, Split, Copy, Hash, Trash2 } from '@lucide/svelte';
	import { getGraphActions } from '../context';

	let { id, onclose }: { id: string; onclose: () => void } = $props();
	const actions = getGraphActions();
	const items = [
		{ icon: SquarePen, label: 'Inspect', key: 'Enter', run: () => actions?.inspect(id) },
		{ icon: Hash, label: 'Copy node id', run: () => actions?.copyId(id) },
		{ icon: Plus, label: 'Add fact', key: 'F', disabled: true },
		{ icon: Split, label: 'Add condition', key: 'C', disabled: true },
		{ icon: Copy, label: 'Duplicate', key: '⌘D', disabled: true },
		{ icon: Trash2, label: 'Delete', key: 'Del', disabled: true, danger: true }
	];
</script>

<svelte:window onpointerdown={onclose} onkeydown={(e) => e.key === 'Escape' && onclose()} />
<div
	class="nodrag nowheel absolute top-9 right-2 z-50 w-52 rounded-xl border bg-popover p-1 text-[13px] shadow-lg"
	role="menu"
	tabindex="-1"
	onpointerdown={(e) => e.stopPropagation()}
>
	{#each items as item, i (item.label)}
		{#if item.danger}<div class="my-1 h-px bg-border"></div>{/if}
		<button
			role="menuitem"
			disabled={item.disabled}
			title={item.disabled ? 'Editing is not available yet' : undefined}
			class={[
				'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left',
				item.disabled
					? 'cursor-not-allowed text-muted-foreground/60'
					: 'cursor-pointer hover:bg-muted',
				i === 0 && 'bg-muted'
			]}
			onclick={(e) => {
				e.stopPropagation();
				item.run?.();
				onclose();
			}}
		>
			<item.icon class="size-4 shrink-0" />{item.label}
			{#if item.key}
				<kbd
					class={[
						'ml-auto rounded-md px-1.5 py-px text-[11px] font-medium',
						i === 0 ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'
					]}>{item.key}</kbd
				>
			{/if}
		</button>
	{/each}
</div>
