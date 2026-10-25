<script lang="ts">
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';
	import { ChevronRight } from '@lucide/svelte';
	import type { ProcessCardData } from '../layout';
	let { data, selected }: NodeProps & { data: ProcessCardData } = $props();
</script>

<Handle type="target" position={Position.Left} class="!pointer-events-none !opacity-0" />
<div
	class={[
		'group flex h-full w-full cursor-pointer flex-col rounded-[16px] border bg-card p-4 text-left transition-shadow',
		selected
			? 'border-brand shadow-[0_0_0_3px_var(--brand-ring)]'
			: 'border-border/80 shadow-xs hover:shadow-md',
		data.dim && 'opacity-35'
	]}
>
	<div class="flex items-center justify-between">
		<div class="text-[15px] font-semibold">{data.title}</div>
		<ChevronRight
			class="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
		/>
	</div>
	<p class="mt-1 line-clamp-2 text-[12px] leading-snug text-muted-foreground">{data.summary}</p>
	<div class="mt-auto flex flex-wrap items-center gap-1.5 pt-3 text-[11px] text-muted-foreground">
		<span class="font-medium text-foreground"
			>{data.steps} {data.steps === 1 ? 'step' : 'steps'}</span
		><span>·</span><span>{data.stages} stages</span><span>·</span>
		<span class="truncate">{data.roles.join(', ')}</span>
	</div>
</div>
<Handle type="source" position={Position.Right} class="!pointer-events-none !opacity-0" />
