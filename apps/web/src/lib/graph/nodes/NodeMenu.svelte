<script lang="ts">
	// Node menu. Inspect only for now; editing actions join it when editing lands.
	import { SquarePen } from '@lucide/svelte';
	import { getGraphActions } from '../context';

	let { id, onclose }: { id: string; onclose: () => void } = $props();
	const actions = getGraphActions();
</script>

<svelte:window onpointerdown={onclose} onkeydown={(e) => e.key === 'Escape' && onclose()} />
<div
	class="nodrag nowheel absolute top-9 right-2 z-50 w-52 rounded-xl border bg-popover p-1 text-[13px] shadow-lg"
	role="menu"
	tabindex="-1"
	onpointerdown={(e) => e.stopPropagation()}
>
	<button
		role="menuitem"
		class="flex w-full cursor-pointer items-center gap-2.5 rounded-lg bg-muted px-2.5 py-1.5 text-left hover:bg-muted"
		onclick={(e) => {
			e.stopPropagation();
			actions?.inspect(id);
			onclose();
		}}
	>
		<SquarePen class="size-4 shrink-0" />Inspect
		<kbd
			class="ml-auto rounded-md bg-foreground px-1.5 py-px text-[11px] font-medium text-background"
			>Enter</kbd
		>
	</button>
</div>
