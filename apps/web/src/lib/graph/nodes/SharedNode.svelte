<script lang="ts">
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';
	import FolderOpen from '@lucide/svelte/icons/folder-open';
	let { data, selected }: NodeProps & { data: { facts: string[] } } = $props();
</script>

<div
	class={[
		'flex h-full w-full cursor-pointer flex-col rounded-[16px] border border-dashed border-foreground/20 bg-card p-4 text-left transition-shadow',
		selected ? '!border-brand shadow-[0_0_0_3px_var(--brand-ring)]' : 'hover:shadow-md'
	]}
>
	<div class="flex items-center gap-2 text-[14px] font-semibold">
		<FolderOpen class="size-4 text-muted-foreground" />Shared fact types
	</div>
	<ul class="mt-2.5 flex flex-col gap-1 text-[12px]">
		{#each data.facts as f (f)}<li class="truncate">{f}</li>{/each}
	</ul>
</div>
<Handle type="source" position={Position.Right} class="!pointer-events-none !opacity-0" />
