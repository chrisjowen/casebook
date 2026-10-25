<script lang="ts">
	// A step's "Records" or "Needs first", edited in place: type a name and press Enter to add one
	// (a fact of that name is reused), rename it or change its kind in its row, and remove it with
	// one click. Picking one of the facts that exist is a secondary way in, below the list. Without
	// `edit` it is a plain list.
	import type { FactId, FactNode } from '@casebook/model';
	import { ArrowLeft, ChevronRight, Plus, TriangleAlert, X } from '@lucide/svelte';
	import {
		collectorsByFact,
		collectsOf,
		factType,
		labelOf,
		requiresOf,
		type ProcessIndex,
		type WorkItem
	} from '$lib/graph/derive';
	import { glyphIcon } from '$lib/graph/glyphs';
	import {
		FACT_KINDS,
		addFactByName,
		removeFromList,
		renameNode,
		setCollects,
		setFactKind,
		setNeeds,
		type Edit,
		type FactList
	} from '$lib/editor/ops';

	let {
		ix,
		item,
		list,
		edit,
		onselect
	}: {
		ix: ProcessIndex;
		item: WorkItem;
		list: FactList;
		/** Saves an edit of the draft; absent when it cannot be edited. */
		edit?: (e: Edit | string) => Promise<boolean>;
		onselect: (id: string) => void;
	} = $props();

	const id = $derived(item.core.id);
	const records = $derived(collectsOf(item).map((c) => c.fact));
	const facts = $derived(list === 'records' ? records : requiresOf(item));
	const collectors = $derived(collectorsByFact(ix));
	const others = $derived(
		ix.facts.filter(
			(f) => !facts.includes(f.core.id) && (list === 'records' || !records.includes(f.core.id))
		)
	);
	let name = $state('');
	let kind = $state(0);
	let picking = $state(false);
	const listId = $derived(`facts-${list}-${id}`);
	const isOutcome = (fact: string) =>
		ix.work.some((w) => w.core.kind === 'decision' && w.core.outcome === fact);
	const neededBy = (fact: string) =>
		ix.work.filter((w) => w.core.id !== id && requiresOf(w).includes(fact as FactId));
	const recordedBy = (fact: string) =>
		(collectors.get(fact as FactId) ?? []).filter((c) => c !== id);

	async function add(e: KeyboardEvent) {
		e.stopPropagation();
		if (e.key === 'Escape') (e.currentTarget as HTMLInputElement).blur();
		if (e.key !== 'Enter' || !name.trim() || !edit) return;
		if (await edit(addFactByName(ix, id, list, name, FACT_KINDS[kind].schema))) {
			name = '';
			kind = 0;
		}
	}
	async function renameFact(fact: string, field: HTMLInputElement) {
		const title = field.value.trim();
		if (!title || title === labelOf(ix, fact) || !edit) {
			field.value = labelOf(ix, fact);
			return;
		}
		if (!(await edit(renameNode(ix, fact, title)))) field.value = labelOf(ix, fact);
	}
	const pick = (fact: FactId) =>
		edit?.(list === 'records' ? setCollects(ix, id, fact, true) : setNeeds(ix, id, fact, true));
</script>

<ul class="flex flex-col gap-1">
	{#each facts as fact (fact)}
		{@const node = ix.byId.get(fact) as FactNode | undefined}
		{@const kindOf = factType(node?.core.schema)}
		{@const Glyph = glyphIcon[kindOf.glyph]}
		{@const simple = FACT_KINDS.findIndex((k) => k.label === kindOf.label)}
		{@const from = recordedBy(fact)}
		{@const users = neededBy(fact)}
		<li class="flex items-start gap-1.5 rounded-lg border px-2 py-1">
			<Glyph class="mt-2 size-3.5 shrink-0 text-muted-foreground" />
			<div class="min-w-0 flex-1">
				{#if edit}
					<input
						type="text"
						class="w-full rounded-md bg-transparent px-1 py-1 text-[13px] outline-none hover:bg-muted/50 focus:bg-muted/70 focus:ring-2 focus:ring-brand-ring"
						value={labelOf(ix, fact)}
						aria-label="Name of {labelOf(ix, fact)}"
						title="Click to rename"
						onchange={(e) => renameFact(fact, e.currentTarget)}
						onkeydown={(e) => {
							e.stopPropagation();
							if (e.key === 'Enter') e.currentTarget.blur();
							if (e.key === 'Escape') {
								e.currentTarget.value = labelOf(ix, fact);
								e.currentTarget.blur();
							}
						}}
					/>
				{:else}
					<div class="px-1 py-1 text-[13px]">{labelOf(ix, fact)}</div>
				{/if}
				<div class="truncate px-1 pb-0.5 text-[11px] text-muted-foreground">
					{#if list === 'records'}
						{users.length
							? `Needed by ${users.map((u) => labelOf(ix, u.core.id)).join(', ')}`
							: 'Not used by a later step yet'}
					{:else if from.length}
						<span class="inline-flex items-center gap-1"
							><ArrowLeft class="size-3" />from {from.map((f) => labelOf(ix, f)).join(', ')}</span
						>
					{:else if records.includes(fact)}
						Recorded by this step
					{:else}
						<span class="inline-flex items-center gap-1 text-amber-700"
							><TriangleAlert class="size-3" />Nothing records this yet</span
						>
					{/if}
				</div>
			</div>
			{#if edit && simple >= 0 && !isOutcome(fact)}
				<select
					class="mt-1 h-7 max-w-24 cursor-pointer rounded-md bg-transparent px-1 text-[11.5px] text-muted-foreground outline-none hover:bg-muted focus:ring-2 focus:ring-brand-ring"
					aria-label="Kind of {labelOf(ix, fact)}"
					value={simple}
					onchange={(e) => edit(setFactKind(ix, fact, Number(e.currentTarget.value)))}
				>
					{#each FACT_KINDS as k, i (k.label)}<option value={i}>{k.label}</option>{/each}
				</select>
			{:else}
				<span class="mt-2 shrink-0 px-1 text-[11.5px] text-muted-foreground">{kindOf.label}</span>
			{/if}
			<button
				class="mt-1 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
				aria-label="More about {labelOf(ix, fact)}"
				title="Choices, guidance and everywhere it is used"
				onclick={() => onselect(fact)}><ChevronRight class="size-3.5" /></button
			>
			{#if edit}
				<button
					class="mt-1 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-destructive"
					aria-label="Remove {labelOf(ix, fact)}"
					title={list === 'records' ? 'Remove from this step' : 'No longer needed here'}
					onclick={() => edit(removeFromList(ix, id, list, fact))}><X class="size-3.5" /></button
				>
			{/if}
		</li>
	{:else}
		{#if !edit}
			<li class="text-[12px] text-muted-foreground">
				{list === 'records'
					? 'Nothing is recorded by this step.'
					: 'Nothing. This can start straight away.'}
			</li>
		{/if}
	{/each}
	{#if edit}
		<li
			class="flex items-center gap-1.5 rounded-lg border border-dashed px-2 py-1 focus-within:border-solid focus-within:border-brand-ring"
		>
			<Plus class="size-3.5 shrink-0 text-muted-foreground" />
			<input
				type="text"
				class="h-8 min-w-0 flex-1 bg-transparent px-1 text-[13px] outline-none placeholder:text-muted-foreground"
				placeholder={list === 'records'
					? 'Add a fact, then Enter'
					: 'Add something it needs, then Enter'}
				aria-label={list === 'records' ? 'Add a fact it records' : 'Add something it needs first'}
				list={listId}
				bind:value={name}
				onkeydown={add}
			/>
			<select
				class="h-7 cursor-pointer rounded-md bg-transparent px-1 text-[11.5px] text-muted-foreground outline-none hover:bg-muted focus:ring-2 focus:ring-brand-ring"
				aria-label="Kind for a new fact"
				bind:value={kind}
			>
				{#each FACT_KINDS as k, i (k.label)}<option value={i}>{k.label}</option>{/each}
			</select>
			<datalist id={listId}
				>{#each others as f (f.core.id)}<option value={labelOf(ix, f.core.id)}
					></option>{/each}</datalist
			>
		</li>
	{/if}
</ul>
{#if edit && others.length}
	<button
		class="-mt-1 cursor-pointer self-start text-[11.5px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
		aria-expanded={picking}
		onclick={() => (picking = !picking)}
		>{picking
			? 'Hide existing facts'
			: `or pick one of the ${others.length} existing facts`}</button
	>
	{#if picking}
		<div class="flex flex-wrap gap-1">
			{#each others as f (f.core.id)}
				{@const by = collectors.get(f.core.id) ?? []}
				<button
					class="cursor-pointer rounded-md border bg-background px-2 py-0.5 text-[12px] hover:border-brand-ring hover:bg-brand-soft"
					title={by.length
						? `Recorded by ${by.map((x) => labelOf(ix, x)).join(', ')}`
						: 'Not recorded by any step yet'}
					onclick={() => pick(f.core.id)}>{labelOf(ix, f.core.id)}</button
				>
			{/each}
		</div>
	{/if}
{/if}
