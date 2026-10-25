<script lang="ts">
	// Step or decision card: header, inset list of the fact types it collects, footer chips.
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';
	import {
		EllipsisVertical,
		GripVertical,
		ShieldCheck,
		Split,
		Sparkles,
		Repeat,
		TriangleAlert,
		UserPlus
	} from '@lucide/svelte';
	import { CARD_HEAD, ROW_H, rowPortY, type CardData } from '../layout';
	import { toneBar } from '../tones';
	import { glyphIcon } from '../glyphs';
	import NodeMenu from './NodeMenu.svelte';

	let { data, selected }: NodeProps & { data: CardData } = $props();
	let menu = $state(false);
</script>

<Handle
	id="in"
	type="target"
	position={Position.Left}
	style="top:{CARD_HEAD / 2}px"
	class="!pointer-events-none !opacity-0"
/>
<Handle
	id="out"
	type="source"
	position={Position.Right}
	style="top:{CARD_HEAD / 2}px"
	class="!opacity-0"
/>
{#each data.rows as row, i (row.id)}
	<Handle
		id="f:{row.id}"
		type="source"
		position={Position.Right}
		style="top:{rowPortY(i)}px"
		class="!opacity-0"
	/>
{/each}

<div
	class={[
		'relative flex h-full w-full cursor-pointer flex-col rounded-[14px] border bg-card text-left transition-[box-shadow,border-color,opacity] duration-150',
		selected
			? 'border-brand shadow-[0_0_0_3px_var(--brand-ring)]'
			: 'border-border/80 shadow-xs hover:border-foreground/20 hover:shadow-md',
		data.dim && 'opacity-35'
	]}
>
	{#if data.badge}
		<span
			class={[
				'absolute -top-[13px] left-3 rounded-lg px-2.5 py-0.5 text-[11px] font-medium shadow-[0_0_0_3px_var(--card)]',
				data.kind === 'decision' ? 'bg-foreground text-background' : 'bg-brand text-white'
			]}>{data.badge}</span
		>
	{/if}
	<div class="flex items-start gap-2 px-3.5 pt-3" style:height="{CARD_HEAD}px">
		<div class="min-w-0 flex-1">
			<div class="truncate text-[13.5px] leading-snug font-semibold">{data.title}</div>
			<div class="mt-0.5 flex items-center gap-1.5 truncate text-[11.5px] text-muted-foreground">
				<span class={['size-1.5 shrink-0 rounded-full', toneBar[data.roleTone]]}></span>
				<span class="truncate">{data.roleTitle} · {data.actor}</span>
				{#if data.missing}<span class="ml-auto shrink-0" title="Needs a fact nothing collects"
						><TriangleAlert class="size-3.5 text-amber-600" /></span
					>{/if}
			</div>
		</div>
		<button
			class="nodrag -mr-1.5 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
			aria-label="Actions for {data.title}"
			onclick={(e) => {
				e.stopPropagation();
				menu = !menu;
			}}><EllipsisVertical class="size-4" /></button
		>
	</div>
	<div class="mx-2.5 rounded-[10px] bg-muted/60 p-[5px]">
		{#each data.rows as row (row.id)}
			{@const Glyph = glyphIcon[row.glyph]}
			<div class="flex items-center gap-1.5 rounded-md px-1.5 text-[12px]" style:height="{ROW_H}px">
				<GripVertical class="size-3 shrink-0 text-muted-foreground/40" />
				<Glyph class="size-3.5 shrink-0 text-muted-foreground" />
				<span class="min-w-0 flex-1 truncate">{row.title}</span>
				<span
					class="shrink-0 rounded-md border border-border/80 bg-background px-1.5 py-px text-[10.5px] text-muted-foreground"
					>{row.type}</span
				>
			</div>
		{:else}
			<div
				class="flex items-center px-1.5 text-[12px] text-muted-foreground"
				style:height="{ROW_H}px"
			>
				Collects nothing
			</div>
		{/each}
		{#if data.moreRows}
			<div
				class="flex items-center pl-6 text-[11.5px] text-muted-foreground"
				style:height="{ROW_H}px"
			>
				+{data.moreRows} more
			</div>
		{/if}
	</div>
	{#if data.guard || data.repeat || data.approval || data.assigns || data.inferred}
		<div
			class="flex min-w-0 items-center gap-1.5 overflow-hidden px-2.5 pt-2 text-[11px] text-muted-foreground"
		>
			{#if data.guard}<span
					class="inline-flex min-w-0 items-center gap-1 rounded-md border px-1.5 py-0.5"
					><Split class="size-3 shrink-0" /><span class="truncate">{data.guard}</span></span
				>{/if}
			{#if data.repeat}<span
					class="inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5"
					><Repeat class="size-3" />{data.repeat}</span
				>{/if}
			{#if data.approval}<span
					class="inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5"
					title={data.approval}><ShieldCheck class="size-3" />Approval</span
				>{/if}
			{#if data.assigns}<span
					class="inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5"
					title="Assigns {data.assigns}"><UserPlus class="size-3" />Assigns</span
				>{/if}
			{#if data.inferred}<span
					class="inline-flex shrink-0 items-center gap-1 rounded-md bg-brand-soft px-1.5 py-0.5 text-brand"
					><Sparkles class="size-3" />Inferred</span
				>{/if}
		</div>
	{/if}
	{#if menu}<NodeMenu id={data.id} onclose={() => (menu = false)} />{/if}
</div>
