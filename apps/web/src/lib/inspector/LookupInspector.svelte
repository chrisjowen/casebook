<script lang="ts">
	// Inspector for a lookup of the process (ADR 0025): its name, guidance and values, the facts
	// chosen from it with the steps that record them, and deleting it once nothing uses it. Every
	// change is an edit of the draft, so it shows in the changes, publishes and undoes like any other.
	import { factsUsingLookup, type LookupNode } from '@casebook/model';
	import { ChevronRight, Share2, Trash2 } from '@lucide/svelte';
	import { changeValues, removeLookup, renameNode, type Edit } from '$lib/editor/ops';
	import { collectorsByFact, labelOf, requiresOf, type ProcessIndex } from '$lib/graph/derive';
	import LookupValues from '$lib/lookups/LookupValues.svelte';
	import EditText from './EditText.svelte';
	import Group from './Group.svelte';

	let {
		ix,
		lookup,
		edit,
		onselect,
		onremoved,
		share
	}: {
		ix: ProcessIndex;
		lookup: LookupNode;
		/** Saves an edit of the draft; absent when it cannot be edited. */
		edit?: (e: Edit | string) => Promise<boolean>;
		onselect: (id: string) => void;
		onremoved?: () => void;
		/** Moves it to the workspace's shared lookups; absent when that cannot be done. */
		share?: () => Promise<unknown>;
	} = $props();

	const id = $derived(lookup.core.id);
	const facts = $derived(factsUsingLookup(ix.document, id));
	const collectors = $derived(collectorsByFact(ix));
	const neededBy = (fact: string) =>
		ix.work.filter((w) => requiresOf(w).includes(fact as never)).map((w) => labelOf(ix, w.core.id));
	const removal = $derived(edit ? removeLookup(ix, id) : undefined);
</script>

<div class="flex flex-col">
	<div class="flex flex-col gap-3.5 px-5 pt-4 pb-5">
		<EditText
			label="Lookup"
			value={labelOf(ix, id)}
			onsave={edit && ((title) => edit(renameNode(ix, id, title)))}
		/>
		<EditText
			label="Guidance"
			value={lookup.content}
			multiline
			placeholder="What these values mean, for whoever chooses one"
			onsave={edit &&
				((content) =>
					edit({
						ops: [{ op: 'set_content', id, content: content === '' ? null : content }],
						label: `Changed the guidance on ${labelOf(ix, id)}`
					}))}
		/>
	</div>
	<Group title="Values">
		<LookupValues
			values={lookup.core.values}
			onchange={edit && ((next) => edit(changeValues(ix, id, next)))}
		/>
		<p class="text-[11px] text-muted-foreground">
			Renaming a value keeps what cases already hold. Turn a value off to stop offering it.
		</p>
	</Group>
	<Group title="Used by" count={facts.length}>
		{#each facts as fact (fact)}
			{@const by = collectors.get(fact) ?? []}
			{@const needs = neededBy(fact)}
			<button
				class="flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-left hover:border-brand-ring hover:bg-brand-soft/40"
				onclick={() => onselect(fact)}
			>
				<span class="min-w-0 flex-1">
					<span class="block text-[12.5px] font-medium">{labelOf(ix, fact)}</span>
					<span class="block truncate text-[11px] text-muted-foreground">
						{by.length
							? `Recorded in ${by.map((b) => labelOf(ix, b)).join(', ')}`
							: 'Not recorded by a step yet'}{needs.length
							? ` · needed by ${needs.join(', ')}`
							: ''}
					</span>
				</span>
				<ChevronRight class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
			</button>
		{:else}
			<p class="text-[12px] text-muted-foreground">
				No fact is chosen from it yet. In a step’s Records, pick it as a fact’s kind.
			</p>
		{/each}
	</Group>
	{#if edit && share}
		<Group title="Share">
			<button
				class="flex cursor-pointer items-center gap-1.5 self-start rounded-lg border px-2.5 py-1.5 text-[12px] hover:bg-muted"
				onclick={share}><Share2 class="size-3.5" />Share with the whole workspace</button
			>
			<p class="text-[11px] text-muted-foreground">
				Moves it to the workspace’s Lookups, so every process there can choose from it. Changes to
				it then go live for all of them straight away.
			</p>
		</Group>
	{/if}
	{#if edit && removal !== undefined}
		<Group title="Remove">
			<button
				class="flex items-center gap-1.5 self-start rounded-lg border px-2.5 py-1.5 text-[12px] text-destructive enabled:cursor-pointer enabled:hover:bg-destructive/5 disabled:cursor-not-allowed disabled:opacity-45"
				disabled={typeof removal === 'string'}
				title={typeof removal === 'string' ? removal : undefined}
				onclick={async () => typeof removal !== 'string' && (await edit(removal)) && onremoved?.()}
				><Trash2 class="size-3.5" />Delete this lookup</button
			>
			<p class="text-[11px] text-muted-foreground">
				{typeof removal === 'string' ? `${removal}.` : 'Nothing uses it. Undo brings it back.'}
			</p>
		</Group>
	{/if}
</div>
