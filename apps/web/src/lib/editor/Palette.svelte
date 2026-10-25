<script lang="ts">
	// ⌘K: one box to add anything or jump to anything, so nothing needs a side tree to be found.
	import type { Component } from 'svelte';
	import { Search } from '@lucide/svelte';
	import type { Command } from '$lib/graph/board-context.svelte';

	let { commands, onclose }: { commands: Command[]; onclose: () => void } = $props();
	let query = $state('');
	let active = $state(0);
	const shown = $derived.by(() => {
		const q = query.trim().toLowerCase();
		const hits = q
			? commands.filter((c) => `${c.label} ${c.hint ?? ''}`.toLowerCase().includes(q))
			: commands.filter((c) => c.group !== 'Go to');
		return hits.slice(0, 12);
	});
	$effect(() => {
		void query;
		active = 0;
	});
	function key(e: KeyboardEvent) {
		e.stopPropagation();
		if (e.key === 'Escape') return onclose();
		if (e.key === 'ArrowDown') active = (active + 1) % Math.max(1, shown.length);
		if (e.key === 'ArrowUp') active = (active - 1 + shown.length) % Math.max(1, shown.length);
		if (e.key === 'Enter' && shown[active]) {
			shown[active].run();
			onclose();
		}
		if (e.key.startsWith('Arrow') || e.key === 'Enter') e.preventDefault();
	}
	const focus = (node: HTMLInputElement) => node.focus();
</script>

<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
<div class="fixed inset-0 z-50 flex justify-center bg-foreground/10 pt-[14vh]" onclick={onclose}>
	<div
		class="h-fit w-[min(560px,calc(100%-32px))] overflow-hidden rounded-2xl border bg-popover shadow-xl"
		role="dialog"
		tabindex="-1"
		aria-label="Quick add and go to"
		onclick={(e) => e.stopPropagation()}
	>
		<label class="flex items-center gap-2.5 border-b px-4">
			<Search class="size-4 text-muted-foreground" />
			<input
				class="h-12 flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted-foreground"
				placeholder="Add a step, a stage, a fact… or jump to one"
				bind:value={query}
				use:focus
				onkeydown={key}
			/>
			<kbd class="rounded-md border px-1.5 text-[11px] text-muted-foreground">Esc</kbd>
		</label>
		<div class="max-h-[50vh] overflow-y-auto p-1.5">
			{#each shown as c, i (i)}
				{@const Icon = c.icon as Component}
				{#if shown[i - 1]?.group !== c.group}
					<div class="px-2.5 pt-2 pb-1 text-[11px] font-medium text-muted-foreground">
						{c.group}
					</div>
				{/if}
				<button
					class={[
						'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px]',
						active === i && 'bg-muted'
					]}
					onpointerenter={() => (active = i)}
					onclick={() => {
						c.run();
						onclose();
					}}
				>
					<Icon class="size-4 shrink-0 text-muted-foreground" />
					<span class="min-w-0 flex-1 truncate">{c.label}</span>
					{#if c.hint}<span class="shrink-0 text-[11.5px] text-muted-foreground">{c.hint}</span
						>{/if}
				</button>
			{:else}
				<p class="px-3 py-6 text-center text-[12.5px] text-muted-foreground">Nothing matches.</p>
			{/each}
		</div>
	</div>
</div>
