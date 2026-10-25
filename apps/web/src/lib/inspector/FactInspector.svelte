<script lang="ts">
	// Definition inspector for a fact type: schema, lookup, evidence, sensitivity, producers,
	// consumers. With `edit`, its name, simple kinds, choices and guidance change the draft. A
	// choice's values are its own options or come from a lookup of the process or a shared one
	// (ADR 0025), and switching between them is one edit.
	import type { FactNode, LookupNode, Operation } from '@casebook/model';
	import { ChevronRight, Trash2 } from '@lucide/svelte';
	import type { ResolvedPathname } from '$app/types';
	import type { SharedLookupRef } from '$lib/definitions/types';
	import {
		changeValues,
		chooseFrom,
		copyIntoProcess,
		lookupFromFact,
		removeFact,
		rename,
		setChoices,
		setMultiple,
		type Edit
	} from '$lib/editor/ops';
	import {
		choicesOf,
		collectsOf,
		describeEvidence,
		evidenceFor,
		factType,
		labelOf,
		requiresOf,
		type ProcessIndex
	} from '$lib/graph/derive';
	import LookupValues from '$lib/lookups/LookupValues.svelte';
	import Field from './Field.svelte';
	import EditText from './EditText.svelte';
	import EditSelect from './EditSelect.svelte';
	import Group from './Group.svelte';

	let {
		ix,
		fact,
		edit,
		change,
		shared = [],
		manage,
		onselect,
		onremoved
	}: {
		ix: ProcessIndex;
		fact: FactNode;
		/** Saves operations as an edit of the draft; absent when it cannot be edited. */
		edit?: (ops: Operation[]) => Promise<boolean>;
		/** Saves a labelled edit, or shows why not; absent when the draft cannot be edited. */
		change?: (e: Edit | string) => Promise<boolean>;
		/** The shared lookups the workspace offers. */
		shared?: SharedLookupRef[];
		/** Where a shared lookup is managed. */
		manage?: (id?: string) => ResolvedPathname;
		onselect?: (id: string) => void;
		onremoved?: () => void;
	} = $props();
	const schema = $derived(fact.core.schema);
	const type = $derived(factType(schema));
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
	const fromList = $derived(lookup?.kind === 'lookup' || lookup?.kind === 'dataset');

	/** Kinds a person can pick here; others, such as people and documents, keep their schema. */
	const KINDS = {
		Text: { type: 'string' },
		Number: { type: 'number' },
		'Yes or no': { type: 'boolean' },
		Date: { type: 'string', format: 'date' },
		Choice: { type: 'string', enum: ['Yes', 'No'] }
	} as const;
	const simple = $derived(
		(type.label in KINDS || type.label === 'Choices') &&
			(!lookup || fromList) &&
			!schema['x-evidence']
	);
	const id = $derived(fact.core.id);
	const setSchema = (changes: Record<string, unknown>): Operation => ({
		op: 'update_core',
		id,
		changes: { schema: changes }
	});
	const toKind = (label: string) =>
		setSchema({
			format: null,
			enum: null,
			items: null,
			minItems: null,
			maxItems: null,
			'x-lookup': null,
			...KINDS[label as keyof typeof KINDS]
		});
	const isOutcome = $derived(
		ix.work.some((w) => w.core.kind === 'decision' && w.core.outcome === fact.core.id)
	);
	// A choice that allows several reads as Choice in the Kind menu; "People can choose several" sets it.
	const kindLabel = $derived(type.label === 'Choices' ? 'Choice' : type.label);

	// Where the choices come from, as the select below names it: "own", "lookup.x" or "shared:name".
	const isChoice = $derived(type.glyph === 'choice');
	const source = $derived(
		lookup?.kind === 'lookup'
			? lookup.lookup
			: lookup?.kind === 'dataset'
				? `shared:${lookup.dataset}`
				: 'own'
	);
	const list = $derived(
		lookup?.kind === 'lookup' ? (ix.byId.get(lookup.lookup) as LookupNode | undefined) : undefined
	);
	const sharedList = $derived(
		lookup?.kind === 'dataset' ? shared.find((l) => l.name === lookup.dataset) : undefined
	);
	const othersUsing = $derived(
		list
			? ix.facts.filter((f) => {
					const l = f.core.schema['x-lookup'];
					return f.core.id !== id && l?.kind === 'lookup' && l.lookup === list.core.id;
				})
			: []
	);
	const sources = $derived([
		{ value: 'own', label: 'Its own options' },
		...ix.lookups.map((l) => ({
			value: l.core.id,
			label: `${labelOf(ix, l.core.id)} (this process)`
		})),
		...shared.map((l) => ({ value: `shared:${l.name}`, label: `${l.title} (shared)` })),
		...(lookup?.kind === 'dataset' && !sharedList
			? [{ value: source, label: `${lookup.dataset} (shared, not found)` }]
			: [])
	]);
	const pick = (value: string) => {
		if (!change) return Promise.resolve(false);
		if (value === 'own') {
			return change(
				chooseFrom(ix, id, {
					kind: 'own',
					options: choicesOf(ix, id)
						.filter((c) => !c.disabled)
						// stored values stay as they are, so cases and conditions keep matching
						.map((c) => c.value)
				})
			);
		}
		if (value.startsWith('shared:')) {
			return change(chooseFrom(ix, id, { kind: 'shared', name: value.slice(7) }));
		}
		return change(chooseFrom(ix, id, { kind: 'lookup', lookup: value as `lookup.${string}` }));
	};
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
				value={kindLabel}
				options={(kindLabel in KINDS ? Object.keys(KINDS) : [kindLabel]).map((k) => ({
					value: k,
					label: k
				}))}
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
		{#if lookup && !fromList}
			<Field label="Chosen from">
				{#if lookup.kind === 'principal'}People{lookup.role
						? ` with the ${labelOf(ix, lookup.role)} role`
						: ''}
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
	{#if isChoice}
		<Group title="Choices">
			<EditSelect label="Come from" value={source} options={sources} onsave={change && pick}>
				{#if list}{labelOf(ix, list.core.id)}, a lookup of this process{:else if lookup?.kind === 'dataset'}{sharedList?.title ??
						lookup.dataset}, a shared lookup{:else}Its own options{/if}
			</EditSelect>
			{#if list}
				<LookupValues
					values={list.core.values}
					onchange={change && ((next) => change(changeValues(ix, list.core.id, next)))}
				/>
				<div class="flex items-center gap-3 text-[11.5px] text-muted-foreground">
					<span class="min-w-0 flex-1"
						>{othersUsing.length
							? `Also used by ${othersUsing.map((f) => labelOf(ix, f.core.id)).join(', ')}; changes apply there too.`
							: `Values of the ${labelOf(ix, list.core.id)} lookup.`}</span
					>
					{#if onselect}<button
							class="inline-flex shrink-0 cursor-pointer items-center gap-0.5 hover:text-foreground"
							onclick={() => onselect(list.core.id)}
							>Open lookup<ChevronRight class="size-3" /></button
						>{/if}
				</div>
			{:else if lookup?.kind === 'dataset'}
				{#if sharedList}
					<LookupValues values={sharedList.values} dense />
				{:else}
					<p class="text-[12px] text-amber-700">
						No shared lookup called {lookup.dataset} is kept for this workspace yet, so it is asked as
						free text.
					</p>
				{/if}
				{#if manage}<a
						href={manage(sharedList?.id)}
						class="inline-flex items-center gap-0.5 self-start text-[11.5px] text-muted-foreground hover:text-foreground"
						>{sharedList ? 'Change it on the Lookups page' : 'Make it on the Lookups page'}</a
					>{/if}
				{#if change && sharedList}
					<button
						class="self-start text-[11.5px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
						title="Make this process's own copy, to change without changing it for everyone"
						onclick={() => change(copyIntoProcess(ix, id, sharedList))}
						>Copy into this process</button
					>
				{/if}
			{:else if change}
				<LookupValues
					values={choicesOf(ix, id).map((c) => ({ value: c.value }))}
					simple
					onchange={(next) =>
						change(
							typeof next === 'string'
								? next
								: setChoices(
										ix,
										id,
										next.map((v) => v.label ?? v.value)
									)
						)}
				/>
				<button
					class="self-start text-[11.5px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
					title="Keep these options as a named list, to reuse, reorder, give codes and meanings and turn off"
					onclick={() => change(lookupFromFact(ix, id))}>Make these a lookup</button
				>
			{:else}
				<LookupValues values={choicesOf(ix, id).map((c) => ({ value: c.value }))} dense />
			{/if}
			{#if change && !isOutcome}
				<label class="flex cursor-pointer items-center gap-2 text-[12.5px]">
					<input
						type="checkbox"
						class="accent-brand"
						checked={schema.type === 'array'}
						onchange={async (e) => {
							const field = e.currentTarget;
							const on = field.checked;
							if (!(await change(setMultiple(ix, id, on)))) field.checked = !on;
						}}
					/>
					People can choose several
				</label>
			{/if}
		</Group>
	{/if}
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
					? `${removal}.`
					: 'Takes it off every step that records or needs it. Undo brings it back.'}
			</p>
		</Group>
	{/if}
</div>
