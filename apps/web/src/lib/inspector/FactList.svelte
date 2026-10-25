<script lang="ts">
	// A step's "Records" or "Needs first", edited in place: type a name and press Enter to add one
	// (a fact of that name is reused), rename it or change its kind in its row, and remove it with
	// one click. Picking one of the facts that exist is a secondary way in, below the list. Without
	// `edit` it is a plain list.
	//
	// A choice can come from a lookup (ADR 0025): the kind menu lists the process's lookups and the
	// shared ones, and "New lookup…" makes one named after the fact, holding its current choices,
	// whose values then open in place under the row.
	import type { FactId, FactNode, FactSchema, LookupNode } from '@casebook/model';
	import { ArrowLeft, ChevronDown, ChevronRight, Plus, TriangleAlert, X } from '@lucide/svelte';
	import {
		choicesOf,
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
		changeValues,
		chooseFrom,
		factByTitle,
		freshId,
		lookupFromFact,
		newLookup,
		removeFromList,
		renameNode,
		setCollects,
		setFactKind,
		setNeeds,
		type Edit,
		type FactList
	} from '$lib/editor/ops';
	import LookupValues from '$lib/lookups/LookupValues.svelte';

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
	const shared = $derived(
		[...ix.shared]
			.map(([name, l]) => ({ name, title: l.title }))
			.sort((a, b) => a.title.localeCompare(b.title))
	);
	let name = $state('');
	let kind = $state('k:0');
	let picking = $state(false);
	/** The fact whose lookup values are open under its row. */
	let open = $state<string | undefined>();
	const listId = $derived(`facts-${list}-${id}`);
	const isOutcome = (fact: string) =>
		ix.work.some((w) => w.core.kind === 'decision' && w.core.outcome === fact);
	const neededBy = (fact: string) =>
		ix.work.filter((w) => w.core.id !== id && requiresOf(w).includes(fact as FactId));
	const recordedBy = (fact: string) =>
		(collectors.get(fact as FactId) ?? []).filter((c) => c !== id);

	/** The kind menu's value for a fact: a simple kind, a lookup, or a shared lookup. */
	function kindValue(schema: FactSchema | undefined): string | undefined {
		const lookup = schema?.['x-lookup'];
		if (lookup?.kind === 'lookup') return `l:${lookup.lookup}`;
		if (lookup?.kind === 'dataset') {
			return schema?.type === 'array' ? undefined : `s:${lookup.dataset}`;
		}
		const simple = FACT_KINDS.findIndex((k) => k.label === factType(schema).label);
		return simple >= 0 ? `k:${simple}` : undefined;
	}

	/** The schema a new fact of the chosen kind starts with. */
	function schemaFor(value: string): FactSchema {
		if (value.startsWith('l:')) {
			return {
				type: 'string',
				'x-lookup': { kind: 'lookup', lookup: value.slice(2) as `lookup.${string}` }
			};
		}
		if (value.startsWith('s:')) {
			return { type: 'string', 'x-lookup': { kind: 'dataset', dataset: value.slice(2) } };
		}
		return FACT_KINDS[Number(value.slice(2))]?.schema ?? FACT_KINDS[0].schema;
	}

	async function add(e: KeyboardEvent) {
		e.stopPropagation();
		if (e.key === 'Escape') (e.currentTarget as HTMLInputElement).blur();
		if (e.key !== 'Enter' || !name.trim() || !edit) return;
		let change: Edit | string;
		let made: string | undefined;
		if (kind === 'new' && !factByTitle(ix, name)) {
			// a new fact chosen from a new lookup of the same name, as one edit
			const lookup = newLookup(ix, name);
			const fact = addFactByName(ix, id, list, name, {
				type: 'string',
				'x-lookup': { kind: 'lookup', lookup: lookup.id }
			});
			made = freshId(ix.document, 'fact', name.trim());
			change =
				typeof fact === 'string'
					? fact
					: { ops: [...lookup.ops, ...fact.ops], label: `${fact.label}, chosen from a new lookup` };
		} else {
			change = addFactByName(ix, id, list, name, schemaFor(kind === 'new' ? 'k:0' : kind));
		}
		if (await edit(change)) {
			name = '';
			if (made) open = made;
			kind = 'k:0';
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
	async function setKind(fact: FactId, value: string, field: HTMLSelectElement, was: string) {
		if (!edit) return;
		let change: Edit | string;
		if (value === 'new') change = lookupFromFact(ix, fact);
		else if (value.startsWith('l:'))
			change = chooseFrom(ix, fact, {
				kind: 'lookup',
				lookup: value.slice(2) as `lookup.${string}`
			});
		else if (value.startsWith('s:'))
			change = chooseFrom(ix, fact, { kind: 'shared', name: value.slice(2) });
		else change = setFactKind(ix, fact, Number(value.slice(2)));
		if (await edit(change)) {
			if (value === 'new' || value.startsWith('l:')) open = fact;
		} else field.value = was;
	}
	const pick = (fact: FactId) =>
		edit?.(list === 'records' ? setCollects(ix, id, fact, true) : setNeeds(ix, id, fact, true));
	const select =
		'h-7 cursor-pointer rounded-md bg-transparent px-1 text-[11.5px] text-muted-foreground outline-none hover:bg-muted focus:ring-2 focus:ring-brand-ring';
</script>

{#snippet kinds(current: string | undefined)}
	{#each FACT_KINDS as k, i (k.label)}<option value="k:{i}">{k.label}</option>{/each}
	<optgroup label="Choose from a lookup">
		{#each ix.lookups as l (l.core.id)}<option value="l:{l.core.id}"
				>Choice · {labelOf(ix, l.core.id)}</option
			>{/each}
		{#each shared as l (l.name)}<option value="s:{l.name}">Choice · {l.title} (shared)</option
			>{/each}
		{#if current && current.startsWith('s:') && !ix.shared.has(current.slice(2))}<option
				value={current}>{current.slice(2)} (shared)</option
			>{/if}
		<option value="new">New lookup…</option>
	</optgroup>
{/snippet}

<ul class="flex flex-col gap-1">
	{#each facts as fact (fact)}
		{@const node = ix.byId.get(fact) as FactNode | undefined}
		{@const kindOf = factType(node?.core.schema)}
		{@const Glyph = glyphIcon[kindOf.glyph]}
		{@const current = kindValue(node?.core.schema)}
		{@const from = recordedBy(fact)}
		{@const users = neededBy(fact)}
		{@const lookup = node?.core.schema['x-lookup']}
		{@const values =
			lookup?.kind === 'lookup'
				? (ix.byId.get(lookup.lookup) as LookupNode | undefined)
				: undefined}
		{@const choices =
			lookup?.kind === 'lookup' || lookup?.kind === 'dataset' ? choicesOf(ix, fact) : []}
		<li class="flex flex-col rounded-lg border px-2 py-1">
			<div class="flex items-start gap-1.5">
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
					<!-- The name has the row; what uses it and its kind share the line below. -->
					<div class="flex items-start gap-2">
						<div
							class="min-w-0 flex-1 px-1 pt-1 pb-0.5 text-[11px] break-words text-muted-foreground"
						>
							{#if list === 'records'}
								{users.length
									? `Needed by ${users.map((u) => labelOf(ix, u.core.id)).join(', ')}`
									: 'Not used by a later step yet'}
							{:else if from.length}
								<span class="inline-flex items-center gap-1"
									><ArrowLeft class="size-3" />from {from
										.map((f) => labelOf(ix, f))
										.join(', ')}</span
								>
							{:else if records.includes(fact)}
								Recorded by this step
							{:else}
								<span class="inline-flex items-center gap-1 text-amber-700"
									><TriangleAlert class="size-3" />Nothing records this yet</span
								>
							{/if}
						</div>
						{#if edit && current && !isOutcome(fact)}
							<select
								class={[select, 'field-sizing-content max-w-40 shrink-0']}
								aria-label="Kind of {labelOf(ix, fact)}"
								value={current}
								onchange={(e) => setKind(fact, e.currentTarget.value, e.currentTarget, current)}
							>
								{@render kinds(current)}
							</select>
						{:else}
							<span class="shrink-0 px-1 pt-1 text-[11.5px] text-muted-foreground"
								>{kindOf.label}</span
							>
						{/if}
					</div>
					{#if values}
						{@const on = values.core.values.filter((v) => !v.disabled).length}
						<button
							class="mb-0.5 flex max-w-full cursor-pointer items-center gap-1 rounded px-1 text-left text-[11px] whitespace-nowrap text-muted-foreground hover:bg-muted hover:text-foreground"
							aria-expanded={open === fact}
							onclick={() => (open = open === fact ? undefined : fact)}
							>{#if open === fact}<ChevronDown class="size-3" />{:else}<ChevronRight
									class="size-3"
								/>{/if}<span class="truncate"
								>{on
									? `${on} ${on === 1 ? 'value' : 'values'} from ${labelOf(ix, values.core.id)}`
									: `No values yet in ${labelOf(ix, values.core.id)}`}</span
							></button
						>
					{:else if lookup?.kind === 'dataset'}
						<div class="truncate px-1 pb-0.5 text-[11px] text-muted-foreground">
							{choices.length
								? `${choices.length} values from ${ix.shared.get(lookup.dataset)?.title} (shared)`
								: `${lookup.dataset}: no shared lookup of that name yet`}
						</div>
					{/if}
				</div>
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
			</div>
			{#if values && open === fact}
				<div class="mt-1 mb-1 ml-5 flex flex-col gap-1.5 border-l pl-2.5">
					<LookupValues
						values={values.core.values}
						dense
						onchange={edit && ((next) => edit(changeValues(ix, values.core.id, next)))}
					/>
					<button
						class="inline-flex cursor-pointer items-center gap-0.5 self-start text-[11px] text-muted-foreground hover:text-foreground"
						onclick={() => onselect(values.core.id)}
						>Open the {labelOf(ix, values.core.id)} lookup<ChevronRight class="size-3" /></button
					>
				</div>
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
					: 'Add what it needs, then Enter'}
				aria-label={list === 'records' ? 'Add a fact it records' : 'Add something it needs first'}
				list={listId}
				bind:value={name}
				onkeydown={add}
			/>
			<select
				class={[select, 'field-sizing-content max-w-32 shrink-0']}
				aria-label="Kind for a new fact"
				bind:value={kind}
			>
				{@render kinds(undefined)}
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
