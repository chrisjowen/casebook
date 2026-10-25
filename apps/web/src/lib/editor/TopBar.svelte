<script lang="ts">
	import { resolve } from '$app/paths';
	import Logo from './Logo.svelte';
	import { Search } from '@lucide/svelte';

	let { query = $bindable('') }: { query?: string } = $props();
	let input = $state<HTMLInputElement>();
</script>

<svelte:window
	onkeydown={(e) => {
		if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
			e.preventDefault();
			input?.focus();
		}
	}}
/>
<header
	class="grid h-14 shrink-0 grid-cols-[1fr_minmax(0,440px)_1fr] items-center gap-4 border-b bg-background px-4"
>
	<a href={resolve('/')} class="flex items-center gap-2"
		><Logo /><span class="text-[15px] font-semibold tracking-tight">casebook</span></a
	>
	<label
		class="flex h-9 items-center gap-2 rounded-xl bg-muted/80 px-3 text-[13px] text-muted-foreground focus-within:ring-2 focus-within:ring-brand-ring"
	>
		<Search class="size-4 shrink-0" />
		<input
			bind:this={input}
			bind:value={query}
			placeholder="Search steps, facts, processes"
			aria-label="Search"
			class="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
		/>
		<kbd class="rounded-md border bg-background px-1.5 text-[11px]">⌘K</kbd>
	</label>
	<div></div>
</header>
