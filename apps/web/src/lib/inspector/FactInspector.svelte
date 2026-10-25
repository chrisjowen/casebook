<script lang="ts">
	// Definition inspector for a fact type: schema, lookup, evidence, sensitivity, producers,
	// consumers. With `edit`, its name, simple kinds, options and guidance change the draft.
	import type { FactNode, Operation } from '@casebook/model';
	import { Trash2 } from '@lucide/svelte';
	import { removeFact, rename } from '$lib/editor/ops';
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
	import EditText from './EditText.svelte';
	import EditSelect from './EditSelect.svelte';
	import Group from './Group.svelte';

	let {
		ix,
		fact,
		edit,
		onremoved
	}: {
		ix: ProcessIndex;
		fact: FactNode;
		/** Saves operations as an edit of the draft; absent when it cannot be edited. */
		edit?: (ops: Operation[]) => Promise<boolean>;
		onremoved?: () => void;
	} = $props();
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

	/** Kinds a person can pick here; others, such as lookups and documents, keep their schema. */
	const KINDS = {
		Text: { type: 'string' },
		Number: { type: 'number' },
		'Yes or no': { type: 'boolean' },
		Date: { type: 'string', format: 'date' },
		Choice: { type: 'string', enum: ['Yes', 'No'] }
	} as const;
	const simple = $derived(type.label in KINDS && !lookup && !schema['x-evidence']);
	const id = $derived(fact.core.id);
	const setSchema = (changes: Record<string, unknown>): Operation => ({
		op: 'update_core',
		id,
		changes: { schema: changes }
	});
	const toKind = (label: string) =>
		setSchema({ format: null, enum: null, ...KINDS[label as keyof typeof KINDS] });
</script>

<div class="flex flex-col">
	<div class="flex flex-col gap-3.5 px-5 pt-4 pb-5">
		<EditText
			label="Fact type"
			value={labelOf(ix, fact.core.id)}
			onsave={edit && ((title) => edit([rename(id, title)]))}
		/>
		<div class="grid grid-cols-2 gap-3">
			<EditSelect
				label="Kind"
				value={type.label}
				options={Object.keys(KINDS).map((k) => ({ value: k, label: k }))}
				onsave={edit && simple ? (kind) => edit([toKind(kind)]) : undefined}
			/>
			<Field label="Sensitivity">{sensitivity[schema['x-sensitivity'] ?? 'none']}</Field>
		</div>
		{#if typeof schema.description === 'string'}<Field label="Description"
				>{schema.description}</Field
			>{/if}
		<EditText
			label="Guidance"
			value={fact.content}
			multiline
			placeholder="What this fact means and how to record it"
			onsave={edit &&
				((content) => edit([{ op: 'set_content', id, content: content === '' ? null : content }]))}
		/>
		{#if edit && simple && type.label === 'Choice'}
			<EditText
				label="Options"
				value={options.join(', ')}
				hint="Separate options with commas."
				onsave={(text) =>
					edit([
						setSchema({
							enum: text
								.split(',')
								.map((o) => o.trim())
								.filter(Boolean)
						})
					])}
			/>
		{:else if options.length}
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
	{#if edit}
		{@const removal = removeFact(ix, id)}
		<Group title="Remove">
			<button
				class="flex items-center gap-1.5 self-start rounded-lg border px-2.5 py-1.5 text-[12px] text-destructive enabled:cursor-pointer enabled:hover:bg-destructive/5 disabled:cursor-not-allowed disabled:opacity-45"
				disabled={typeof removal === 'string'}
				title={typeof removal === 'string' ? removal : undefined}
				onclick={async () =>
					typeof removal !== 'string' && (await edit(removal.ops)) && onremoved?.()}
				><Trash2 class="size-3.5" />Delete this fact type</button
			>
			<p class="text-[11px] text-muted-foreground">
				{typeof removal === 'string'
					? `${removal}; delete the decision instead.`
					: 'Takes it off every step that records or needs it. Undo brings it back.'}
			</p>
		</Group>
	{/if}
</div>
