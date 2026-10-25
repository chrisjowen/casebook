<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		title,
		count,
		hint,
		children
	}: { title: string; count?: number; hint?: string; children: Snippet } = $props();
</script>

<section class="mt-8 first:mt-0">
	<div class="mb-2 flex flex-wrap items-baseline gap-x-2 px-1">
		<h2 class="text-[13px] font-semibold">{title}</h2>
		{#if count !== undefined}<span class="text-[13px] text-muted-foreground">{count}</span>{/if}
		{#if hint}<span class="ml-auto text-[12px] text-muted-foreground">{hint}</span>{/if}
	</div>
	<div class="divide-y overflow-hidden rounded-xl border bg-card">
		{@render children()}
	</div>
</section>
