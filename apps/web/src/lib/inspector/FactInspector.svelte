<script lang="ts">
	// Definition inspector for a fact type: schema, lookup, evidence, sensitivity, producers, consumers.
	import type { FactNode } from '@casebook/model';
	import {
		collectsOf,
		describeEvidence,
		evidenceFor,
		factType,
		labelOf,
		requiresOf,
		type ProcessIndex
	} from '$lib/graph/derive';
	import Field from './Field.svelte';
	import Group from './Group.svelte';

	let { ix, fact }: { ix: ProcessIndex; fact: FactNode } = $props();
	const schema = $derived(fact.core.schema);
	const type = $derived(factType(schema));
	const options = $derived(
		Array.isArray(schema.enum) ? (schema.enum as unknown[]).map(String) : []
	);
	const collectedBy = $derived(
		ix.work.filter((w) => collectsOf(w).some((c) => c.fact === fact.core.id))
	);
	const neededBy = $derived(ix.work.filter((w) => requiresOf(w).includes(fact.core.id)));
	const sensitivity = {
		none: 'Not personal',
		personal: 'Personal data',
		sensitive: 'Sensitive personal data'
	} as const;
	const lookup = $derived(schema['x-lookup']);
</script>

<div class="flex flex-col">
	<div class="flex flex-col gap-3.5 px-5 pt-4 pb-5">
		<Field label="Fact type">{labelOf(ix, fact.core.id)}</Field>
		<div class="grid grid-cols-2 gap-3">
			<Field label="Kind">{type.label}</Field>
			<Field label="Sensitivity">{sensitivity[schema['x-sensitivity'] ?? 'none']}</Field>
		</div>
		{#if typeof schema.description === 'string'}<Field label="Description"
				>{schema.description}</Field
			>{/if}
		{#if fact.content}<Field label="Guidance">{fact.content}</Field>{/if}
		{#if options.length}
			<div class="flex flex-col gap-1.5">
				<div class="text-[12px] text-muted-foreground">Options</div>
				<div class="flex flex-wrap gap-1.5">
					{#each options as o (o)}<span class="rounded-md border px-2 py-0.5 text-[12px]">{o}</span
						>{/each}
				</div>
			</div>
		{/if}
		{#if lookup}
			<Field label="Chosen from">
				{#if lookup.kind === 'principal'}People{lookup.role
						? ` with the ${labelOf(ix, lookup.role)} role`
						: ''}
				{:else if lookup.kind === 'dataset'}The {lookup.dataset.replaceAll('-', ' ')} list
				{:else if lookup.kind === 'fact'}The values of “{labelOf(ix, lookup.fact)}”
				{:else}Another case{/if}
			</Field>
		{/if}
		{#if schema['x-evidence']}
			<Field label="Evidence" hint="The default; a step can ask for its own format."
				>{schema['x-evidence'].description} · {describeEvidence(schema['x-evidence'])}</Field
			>
		{/if}
	</div>
	<Group title="Collected by" count={collectedBy.length}>
		{#each collectedBy as w (w.core.id)}<div class="rounded-lg border px-3 py-2 text-[12.5px]">
				{labelOf(ix, w.core.id)}
			</div>
		{:else}<p class="text-[12px] text-amber-700">Nothing collects this yet.</p>{/each}
	</Group>
	<Group title="Needed by" count={neededBy.length}>
		{#each neededBy as w (w.core.id)}
			{@const evidence = evidenceFor(ix, w, fact.core.id)}
			<div class="rounded-lg border px-3 py-2 text-[12.5px]">
				{labelOf(ix, w.core.id)}
				{#if evidence}<div class="text-[11px] text-muted-foreground">
						Asks for: {describeEvidence(evidence)}
					</div>{/if}
			</div>
		{:else}<p class="text-[12px] text-muted-foreground">
				No step needs it; it is an output of the process.
			</p>{/each}
	</Group>
</div>
