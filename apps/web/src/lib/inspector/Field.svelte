<script lang="ts">
	import type { Snippet } from 'svelte';
	let { label, children, hint }: { label: string; children: Snippet; hint?: string } = $props();
</script>

<div class="flex flex-col gap-1.5">
	<div class="text-[12px] text-muted-foreground">{label}</div>
	<div class="min-h-9 rounded-lg bg-muted/70 px-3 py-2 text-[13px] leading-snug">
		{@render children()}
	</div>
	{#if hint}<div class="text-[11px] text-muted-foreground">{hint}</div>{/if}
</div>
