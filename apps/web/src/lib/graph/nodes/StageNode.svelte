<script lang="ts">
	import type { NodeProps } from '@xyflow/svelte';
	let { data }: NodeProps & { data: { title: string; index: number; count: number } } = $props();
</script>

<div
	class="h-full w-full rounded-[18px] border border-dashed border-foreground/10 bg-foreground/[0.018]"
>
	<div class="flex items-center gap-2 px-4 pt-3.5 text-[12px]">
		<span
			class="flex size-5 items-center justify-center rounded-md bg-background text-[11px] font-medium text-muted-foreground shadow-xs"
			>{data.index}</span
		>
		<span class="font-medium text-foreground/80">{data.title}</span>
		<span class="text-muted-foreground">· {data.count} {data.count === 1 ? 'item' : 'items'}</span>
	</div>
</div>
