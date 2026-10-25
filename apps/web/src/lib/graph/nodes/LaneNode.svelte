<script lang="ts">
	import type { NodeProps } from '@xyflow/svelte';
	import { toneBar, toneLane } from '../tones';
	let {
		data
	}: NodeProps & { data: { title: string; perCase: boolean; tone: number; labelWidth: number } } =
		$props();
</script>

<div
	class={[
		'flex h-full w-full overflow-hidden rounded-xl border border-border/60',
		toneLane[data.tone]
	]}
>
	<div
		class="flex shrink-0 items-center gap-2.5 border-r border-border/60 bg-background/70 px-3"
		style:width="{data.labelWidth}px"
	>
		<span class={['h-8 w-1 rounded-full', toneBar[data.tone]]}></span>
		<div class="min-w-0">
			<div class="text-[13px] leading-tight font-medium">{data.title}</div>
			{#if data.perCase}<div class="text-[11px] text-muted-foreground">Assigned per case</div>{/if}
		</div>
	</div>
</div>
