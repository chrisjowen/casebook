<script lang="ts">
	// Compact card for role lanes and fact flow: name, role, small definition icons.
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import Split from '@lucide/svelte/icons/split';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import Repeat from '@lucide/svelte/icons/repeat';
	import Bot from '@lucide/svelte/icons/bot';
	import Signpost from '@lucide/svelte/icons/signpost';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import type { CardData } from '../layout';
	import { toneBar } from '../tones';

	let { data, selected }: NodeProps & { data: CardData & { hideRole?: boolean } } = $props();
	const icon = 'size-3.5 shrink-0';
</script>

<Handle type="target" position={Position.Left} class="!pointer-events-none !opacity-0" />
<div
	class={[
		'flex h-full w-full cursor-pointer flex-col justify-between rounded-[14px] border bg-card px-3.5 py-3 text-left transition-[box-shadow,border-color,opacity] duration-150',
		selected
			? 'border-brand shadow-[0_0_0_3px_var(--brand-ring)]'
			: 'border-border/80 shadow-xs hover:border-foreground/20 hover:shadow-md',
		data.dim && 'opacity-35'
	]}
>
	<div class="min-w-0">
		<div class="line-clamp-2 text-[13px] leading-snug font-semibold">{data.title}</div>
		{#if !data.hideRole}
			<div class="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
				<span class={['size-1.5 shrink-0 rounded-full', toneBar[data.roleTone]]}></span><span
					class="truncate">{data.roleTitle}</span
				>
			</div>
		{/if}
	</div>
	<div class="flex items-center justify-end gap-1.5 text-muted-foreground">
		{#if data.missing}<span title="Needs a fact nothing collects"
				><TriangleAlert class="{icon} text-amber-600" /></span
			>{/if}
		{#if data.kind === 'decision'}<span title="Decision"><Signpost class={icon} /></span>{/if}
		{#if data.guard}<span title={data.guard}><Split class={icon} /></span>{/if}
		{#if data.repeat}<span title={data.repeat}><Repeat class={icon} /></span>{/if}
		{#if data.approval}<span title="Needs approval"><ShieldCheck class={icon} /></span>{/if}
		{#if data.assigns}<span title="Assigns {data.assigns}"><UserPlus class={icon} /></span>{/if}
		{#if data.actor !== 'Person only'}<span title={data.actor}><Bot class={icon} /></span>{/if}
		{#if data.inferred}<span title="Inferred, not stated in the source"
				><Sparkles class="{icon} text-brand" /></span
			>{/if}
	</div>
</div>
<Handle type="source" position={Position.Right} class="!pointer-events-none !opacity-0" />
