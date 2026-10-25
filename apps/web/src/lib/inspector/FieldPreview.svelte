<script lang="ts">
	// Read-only sketch of the input a fact type will produce at run time. Never an input itself.
	import type { FactNode } from '@casebook/model';
	import { Upload, Lock, ChevronDown, Users, Search, Plus } from '@lucide/svelte';
	import { choicesOf, describeEvidence, labelOf, type ProcessIndex } from '$lib/graph/derive';
	let { ix, fact }: { ix: ProcessIndex; fact: FactNode } = $props();
	const schema = $derived(fact.core.schema);
	const options = $derived.by(() => {
		const choices = choicesOf(ix, fact.core.id).filter((c) => !c.disabled);
		return choices.length || Array.isArray(schema.enum) ? choices.map((c) => c.label) : undefined;
	});
	const box =
		'flex h-9 w-full items-center rounded-md border border-input bg-background px-3 text-[13px] text-muted-foreground/80';
</script>

<div class="flex flex-col gap-1.5">
	<div class="flex items-center gap-1.5 text-[13px] font-medium">
		{labelOf(ix, fact.core.id)}
		{#if schema['x-sensitivity'] === 'sensitive'}<Lock
				class="size-3 text-muted-foreground"
				aria-label="Sensitive"
			/>{/if}
	</div>
	{#if options && options.length <= 4}
		<div class="flex flex-wrap gap-1.5">
			{#each options as o (o)}<span
					class="rounded-md border px-2.5 py-1 text-[12px] text-muted-foreground">{o}</span
				>{/each}
		</div>
	{:else if options}
		<div class={box}>Choose one of {options.length}<ChevronDown class="ml-auto size-4" /></div>
	{:else if schema['x-lookup']?.kind === 'principal'}
		<div class={box}>
			<Users class="mr-2 size-4" />Pick people{#if schema['x-lookup'].role}&nbsp;with the {labelOf(
					ix,
					schema['x-lookup'].role
				)} role{/if}<Plus class="ml-auto size-4" />
		</div>
	{:else if schema['x-lookup']}
		<div class={box}><Search class="mr-2 size-4" />Search</div>
	{:else if schema['x-evidence']}
		<div
			class="flex items-center gap-2 rounded-md border border-dashed px-3 py-2.5 text-[12px] text-muted-foreground"
		>
			<Upload class="size-4 shrink-0" />{describeEvidence(schema['x-evidence'])}
		</div>
	{:else if schema.type === 'boolean'}
		<div class="flex gap-1.5">
			<span class="rounded-md border px-2.5 py-1 text-[12px] text-muted-foreground">Yes</span><span
				class="rounded-md border px-2.5 py-1 text-[12px] text-muted-foreground">No</span
			>
		</div>
	{:else}
		<div class={box}></div>
	{/if}
</div>
