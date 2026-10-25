<script lang="ts">
	import type { Snippet } from 'svelte';
	let { title, count, children }: { title: string; count?: number; children: Snippet } = $props();
</script>

<section class="flex flex-col gap-2.5 border-t px-5 py-4">
	<div class="flex items-center gap-2">
		<h3 class="text-[11px] font-semibold tracking-wide text-foreground/70 uppercase">{title}</h3>
		{#if count !== undefined}<span
				class="rounded-md bg-muted px-1.5 text-[11px] text-muted-foreground">{count}</span
			>{/if}
	</div>
	{@render children()}
</section>
