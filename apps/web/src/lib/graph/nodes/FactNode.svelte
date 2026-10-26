<script lang="ts">
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import Lock from '@lucide/svelte/icons/lock';
	import type { FactData } from '../layout';
	import { glyphIcon } from '../glyphs';
	let { data, selected }: NodeProps & { data: FactData } = $props();
	const Glyph = $derived(glyphIcon[data.glyph]);
</script>

<Handle type="target" position={Position.Left} class="!pointer-events-none !opacity-0" />
<div
	class={[
		'flex h-full w-full cursor-pointer items-center gap-2 rounded-xl border px-3 text-left shadow-xs transition-[border-color,opacity]',
		data.missing
			? 'border-dashed border-amber-500 bg-amber-50 text-amber-950'
			: 'border-border/80 bg-card',
		selected && '!border-brand shadow-[0_0_0_3px_var(--brand-ring)]',
		data.dim && 'opacity-35'
	]}
>
	{#if data.missing}<TriangleAlert class="size-3.5 shrink-0 text-amber-600" />{:else}<Glyph
			class="size-3.5 shrink-0 text-muted-foreground"
		/>{/if}
	<div class="min-w-0 leading-tight">
		<div class="truncate text-[12px]">{data.title}</div>
		{#if data.missing}<div class="truncate text-[10px] text-amber-700">
				Nothing collects this
			</div>{/if}
	</div>
	{#if data.sensitive}<Lock
			class="ml-auto size-3 shrink-0 text-muted-foreground/70"
			aria-label="Sensitive"
		/>{/if}
</div>
<Handle type="source" position={Position.Right} class="!pointer-events-none !opacity-0" />
