<script lang="ts">
	// Context menu at a screen point: arrow keys move, Enter runs, Escape or a click outside closes.
	// Disabled items stay visible with the reason.
	import type { Component } from 'svelte';
	import type { MenuState } from '$lib/graph/board-context.svelte';

	let { menu, onclose }: { menu: MenuState; onclose: () => void } = $props();
	let el = $state<HTMLDivElement>();
	const runnable = $derived(
		menu.items.map((item, i) => ({ item, i })).filter(({ item }) => !item.sep && !item.disabled)
	);
	// the first item that can run is highlighted; arrow keys and the pointer move it
	let active = $derived(runnable[0]?.i ?? 0);
	let pos = $state({ x: 0, y: 0 });
	$effect(() => {
		if (!el) return;
		const r = el.getBoundingClientRect();
		pos = {
			x: Math.min(menu.x, window.innerWidth - r.width - 8),
			y: Math.min(menu.y, window.innerHeight - r.height - 8)
		};
		el.focus();
	});
	function key(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.stopPropagation();
			onclose();
			return;
		}
		const at = runnable.findIndex((r) => r.i === active);
		if (e.key === 'ArrowDown') active = runnable[(at + 1) % runnable.length]?.i ?? 0;
		if (e.key === 'ArrowUp')
			active = runnable[(at - 1 + runnable.length) % runnable.length]?.i ?? 0;
		if (e.key === 'Enter') {
			menu.items[active]?.run?.();
			onclose();
		}
		e.stopPropagation();
		if (e.key.startsWith('Arrow') || e.key === 'Enter') e.preventDefault();
	}
</script>

<svelte:window onpointerdown={(e) => !el?.contains(e.target as Node) && onclose()} />
<div
	bind:this={el}
	class="fixed z-50 w-60 rounded-xl border bg-popover p-1 text-[13px] shadow-lg outline-none"
	style="left:{pos.x || menu.x}px; top:{pos.y || menu.y}px"
	role="menu"
	tabindex="-1"
	onkeydown={key}
	oncontextmenu={(e) => e.preventDefault()}
>
	{#if menu.title}
		<div class="truncate px-2.5 pt-1.5 pb-1 text-[11px] font-medium text-muted-foreground">
			{menu.title}
		</div>
	{/if}
	{#each menu.items as item, i (i)}
		{#if item.sep}
			<div class="my-1 h-px bg-border"></div>
		{:else}
			{@const Icon = item.icon as Component | undefined}
			<button
				role="menuitem"
				disabled={!!item.disabled}
				title={item.disabled ?? item.hint}
				class={[
					'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left',
					item.disabled ? 'cursor-not-allowed text-muted-foreground/60' : 'cursor-pointer',
					!item.disabled && active === i && 'bg-muted',
					!item.disabled && item.danger && 'text-destructive'
				]}
				onpointerenter={() => !item.disabled && (active = i)}
				onclick={() => {
					item.run?.();
					onclose();
				}}
			>
				{#if Icon}<Icon class="size-4 shrink-0" />{:else}<span class="size-4 shrink-0"></span>{/if}
				<span class="min-w-0 flex-1 truncate">{item.label}</span>
				{#if item.kbd}<kbd
						class="ml-auto shrink-0 rounded-md border bg-background px-1.5 text-[10.5px] text-muted-foreground"
						>{item.kbd}</kbd
					>{/if}
			</button>
		{/if}
	{/each}
</div>
