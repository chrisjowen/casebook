<script lang="ts">
	// A step or decision on the board. For someone who can edit, everything about it is done in
	// place: double-click the name to rename, "+ Add fact" under its facts, drag a fact's dot onto
	// a step that needs it, drag or click the "+" on its right edge to add what comes next.
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';
	import {
		EllipsisVertical,
		GitBranch,
		Plus,
		Split,
		Repeat,
		ShieldCheck,
		TriangleAlert
	} from '@lucide/svelte';
	import { BOARD_HEAD, BOARD_ROW, boardRowY, type BoardCardData } from '../board';
	import { getBoard } from '../board-context.svelte';
	import { glyphIcon } from '../glyphs';
	import { toneBar } from '../tones';

	let { id, data, selected }: NodeProps & { data: BoardCardData } = $props();
	const { ui, actions } = getBoard();
	const editable = $derived(actions.editable);
	const renaming = $derived(ui.renaming === id);
	const needed = $derived(!!ui.highlightFact && data.requires.includes(ui.highlightFact));
	let adding = $state(false);
	let draft = $state('');

	function commitTitle(e: Event) {
		const value = (e.currentTarget as HTMLInputElement).value.trim();
		if (ui.renaming !== id) return;
		ui.renaming = undefined;
		if (value && value !== data.title) actions.rename(id, value);
	}
	function addRow(e: KeyboardEvent) {
		e.stopPropagation();
		if (e.key === 'Escape') {
			adding = false;
			draft = '';
		}
		if (e.key !== 'Enter' || !draft.trim()) return;
		if (data.kind === 'decision') actions.addChoice(id, draft.trim());
		else actions.addFact(id, draft.trim());
		draft = '';
	}
	function next(e: MouseEvent) {
		e.stopPropagation();
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
		actions.quickAdd({ x: r.right + 8, y: r.top - 8, stage: data.stage, after: id });
	}
	const focus = (el: HTMLInputElement) => {
		el.focus();
		el.select();
	};
</script>

<Handle
	id="in"
	type="target"
	position={Position.Left}
	style="top:{BOARD_HEAD / 2}px"
	class="cb-in"
/>
{#if editable}
	<Handle
		id="out"
		type="source"
		position={Position.Right}
		style="top:{BOARD_HEAD / 2}px"
		class="cb-out"
		title="Drag onto a step to link it, or into space to add what comes next"
	/>
	{#each data.rows as row, i (row.handle)}
		<Handle
			id={row.handle}
			type="source"
			position={Position.Right}
			style="top:{boardRowY(i)}px"
			class="cb-row"
			title={row.glyph === 'branch'
				? `Drag to add or link what happens when it is ${row.title}`
				: `Drag onto a step that needs ${row.title}`}
		/>
	{/each}
	<button
		class={['cb-plus nodrag nopan', data.leaf && 'cb-plus-leaf']}
		style="top:{BOARD_HEAD / 2 - 11}px"
		aria-label="Add what comes after {data.title}"
		title="Add what comes next"
		onclick={next}><Plus class="size-3.5" /></button
	>
{:else}
	<Handle
		id="out"
		type="source"
		position={Position.Right}
		style="top:{BOARD_HEAD / 2}px"
		class="cb-hidden"
	/>
	{#each data.rows as row, i (row.handle)}
		<Handle
			id={row.handle}
			type="source"
			position={Position.Right}
			style="top:{boardRowY(i)}px"
			class="cb-hidden"
		/>
	{/each}
{/if}

<div
	class={[
		'cb-card relative flex h-full w-full flex-col rounded-[14px] border bg-card text-left transition-[box-shadow,border-color,opacity] duration-150',
		selected
			? 'border-brand shadow-[0_0_0_3px_var(--brand-ring)]'
			: needed
				? 'border-brand-ring shadow-[0_0_0_3px_var(--brand-soft)]'
				: 'border-border/80 shadow-xs hover:border-foreground/20 hover:shadow-md',
		data.dim && 'opacity-35'
	]}
>
	{#if data.kind === 'decision'}
		<span
			class="absolute -top-[11px] left-3 rounded-md bg-foreground px-2 py-px text-[10.5px] font-medium text-background shadow-[0_0_0_3px_var(--card)]"
			>Decision</span
		>
	{/if}
	<div class="flex items-start gap-1.5 px-3.5 pt-3" style:height="{BOARD_HEAD}px">
		<div class="min-w-0 flex-1">
			{#if renaming}
				<input
					class="nodrag nopan -mx-1 -my-0.5 w-[calc(100%+8px)] rounded-md bg-muted px-1 py-0.5 text-[13.5px] font-semibold outline-none focus:ring-2 focus:ring-brand-ring"
					value={data.title}
					aria-label="Name"
					use:focus
					onblur={commitTitle}
					onkeydown={(e) => {
						e.stopPropagation();
						if (e.key === 'Enter') e.currentTarget.blur();
						if (e.key === 'Escape') ui.renaming = undefined;
					}}
				/>
			{:else}
				<div
					class="truncate text-[13.5px] leading-snug font-semibold"
					title={editable ? 'Double-click to rename' : data.title}
					role="textbox"
					tabindex="-1"
					aria-readonly={!editable}
					ondblclick={(e) => {
						if (!editable) return;
						e.stopPropagation();
						ui.renaming = id;
					}}
				>
					{data.title}
				</div>
			{/if}
			<div class="mt-0.5 flex items-center gap-1.5 truncate text-[11.5px] text-muted-foreground">
				<span class={['size-1.5 shrink-0 rounded-full', toneBar[data.roleTone]]}></span>
				<span class="truncate">{data.role} · {data.actor}</span>
			</div>
		</div>
		{#if editable}
			<button
				class="nodrag -mr-1.5 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
				aria-label="Actions for {data.title}"
				onclick={(e) => {
					e.stopPropagation();
					const r = e.currentTarget.getBoundingClientRect();
					actions.cardMenu(id, r.left, r.bottom + 4);
				}}><EllipsisVertical class="size-4" /></button
			>
		{/if}
	</div>
	<div class="mx-2.5 rounded-[10px] bg-muted/60 p-[5px]">
		{#each data.rows as row (row.handle)}
			{@const Glyph = row.glyph === 'branch' ? GitBranch : glyphIcon[row.glyph]}
			<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
			<div
				class="flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-[12px] hover:bg-background"
				style:height="{BOARD_ROW}px"
				onmouseenter={() => row.glyph !== 'branch' && (ui.highlightFact = row.fact)}
				onmouseleave={() => (ui.highlightFact = undefined)}
				onclick={(e) => {
					e.stopPropagation();
					actions.select(row.glyph === 'branch' ? id : row.fact);
				}}
			>
				<Glyph class="size-3.5 shrink-0 text-muted-foreground" />
				<span class="min-w-0 flex-1 truncate">{row.title}</span>
				{#if row.glyph !== 'branch'}<span
						class="shrink-0 pr-2 text-[10.5px] text-muted-foreground/80">{row.type}</span
					>{/if}
			</div>
		{/each}
		{#if data.more}
			<div
				class="flex items-center pl-6 text-[11.5px] text-muted-foreground"
				style:height="{BOARD_ROW}px"
			>
				+{data.more} more
			</div>
		{/if}
		{#if !editable}
			{#if !data.rows.length}
				<div
					class="flex items-center px-1.5 text-[12px] text-muted-foreground"
					style:height="{BOARD_ROW}px"
				>
					Records nothing
				</div>
			{:else}
				<div style:height="{BOARD_ROW}px"></div>
			{/if}
		{:else if adding}
			<input
				class="nodrag nopan w-full rounded-md bg-background px-2 text-[12px] outline-none focus:ring-2 focus:ring-brand-ring"
				style:height="{BOARD_ROW}px"
				placeholder={data.kind === 'decision' ? 'Choice, then Enter' : 'Fact name, then Enter'}
				aria-label={data.kind === 'decision' ? 'New choice' : 'New fact'}
				list={data.kind === 'step' ? `card-facts-${id}` : undefined}
				bind:value={draft}
				use:focus
				onkeydown={addRow}
				onblur={() => {
					adding = false;
					draft = '';
				}}
			/>
			{#if data.kind === 'step'}<datalist id="card-facts-{id}"
					>{#each actions.factTitles() as t (t)}<option value={t}></option>{/each}</datalist
				>{/if}
		{:else}
			<button
				class="nodrag flex w-full cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-[12px] text-muted-foreground/70 hover:bg-background hover:text-foreground"
				style:height="{BOARD_ROW}px"
				onclick={(e) => {
					e.stopPropagation();
					adding = true;
				}}
				><Plus class="size-3.5" />{data.kind === 'decision'
					? 'Add choice'
					: data.rows.length
						? 'Add fact'
						: 'Add a fact it records'}</button
			>
		{/if}
	</div>
	{#if data.guard || data.repeat || data.approval || data.missing.length}
		<div
			class="flex min-w-0 items-center gap-1.5 overflow-hidden px-2.5 pt-2 text-[11px] text-muted-foreground"
		>
			{#if data.missing.length}<span
					class="inline-flex min-w-0 items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-amber-800"
					title="Needs {data.missing.join(', ')}, which nothing records"
					><TriangleAlert class="size-3 shrink-0" /><span class="truncate"
						>Needs {data.missing[0]}</span
					></span
				>{/if}
			{#if data.guard}<span
					class="inline-flex min-w-0 items-center gap-1 rounded-md border px-1.5 py-0.5"
					title={data.guard}
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
		</div>
	{/if}
</div>
