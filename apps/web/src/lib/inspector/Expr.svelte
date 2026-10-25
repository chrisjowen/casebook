<script lang="ts">
	// A guard expression shown as code, with node ids replaced by highlighted plain names.
	import { labelOf, type ProcessIndex } from '$lib/graph/derive';
	let { expr, ix }: { expr: string; ix: ProcessIndex } = $props();
	const parts = $derived(
		expr
			.split(/((?:fact|role)\.[a-z0-9]+(?:-[a-z0-9]+)*)/g)
			.map((t) => (/^(?:fact|role)\./.test(t) ? { name: labelOf(ix, t) } : { text: t }))
	);
</script>

<div
	class="rounded-lg bg-muted/70 px-3 py-2.5 font-mono text-[12px] leading-relaxed break-words text-foreground/80"
>
	{#each parts as p, i (i)}{#if p.name}<span class="rounded bg-brand-soft px-1 text-brand"
				>{p.name}</span
			>{:else}{p.text}{/if}{/each}
</div>
