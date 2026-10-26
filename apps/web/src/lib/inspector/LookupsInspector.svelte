<script lang="ts">
	// The lookups a process's choice facts can be chosen from (ADR 0025): its own, which open in
	// their own inspector, and the shared lookups its workspace offers, which are managed on the
	// Lookups page. A new lookup is named first, then filled in its inspector.
	import { factsUsingLookup, factsUsingShared, labelOfValue } from '@casebook/model';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import ListChecks from '@lucide/svelte/icons/list-checks';
	import Plus from '@lucide/svelte/icons/plus';
	import type { ResolvedPathname } from '$app/types';
	import type { SharedLookupRef } from '$lib/definitions/types';
	import { newLookup, type Edit } from '$lib/editor/ops';
	import { labelOf, type ProcessIndex } from '$lib/graph/derive';
	import Group from './Group.svelte';

	let {
		ix,
		shared,
		edit,
		onselect,
		manage
	}: {
		ix: ProcessIndex;
		shared: SharedLookupRef[];
		/** Saves an edit of the draft; absent when it cannot be edited. */
		edit?: (e: Edit | string) => Promise<boolean>;
		onselect: (id: string) => void;
		/** Where a shared lookup is managed, or the Lookups page itself. */
		manage: (id?: string) => ResolvedPathname;
	} = $props();

	let name = $state('');
	const preview = (values: { value: string; label?: string; disabled?: boolean }[]) => {
		const on = values.filter((v) => !v.disabled).map(labelOfValue);
		return on.length
			? `${on.slice(0, 4).join(', ')}${on.length > 4 ? ` and ${on.length - 4} more` : ''}`
			: 'No values yet';
	};
	const uses = (n: number) => (n ? `${n} ${n === 1 ? 'fact' : 'facts'}` : 'Not used');

	async function add(e: SubmitEvent) {
		e.preventDefault();
		if (!edit || !name.trim()) return;
		if (await edit(newLookup(ix, name))) name = '';
	}
</script>

<div class="flex flex-col">
	<p class="px-5 pt-4 pb-4 text-[12.5px] text-muted-foreground">
		Lists of values a choice is made from, such as severities or document types. Make one here, or
		pick one as a fact’s kind in a step’s Records.
	</p>
	<Group title="In this process" count={ix.lookups.length}>
		{#each ix.lookups as l (l.core.id)}
			<button
				class="flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 text-left hover:border-brand-ring hover:bg-brand-soft/40"
				onclick={() => onselect(l.core.id)}
			>
				<ListChecks class="mt-0.5 size-3.5 shrink-0 text-brand" />
				<span class="min-w-0 flex-1">
					<span class="flex items-baseline gap-2">
						<span class="truncate text-[13px] font-medium">{labelOf(ix, l.core.id)}</span>
						<span class="ml-auto shrink-0 text-[11px] text-muted-foreground"
							>{uses(factsUsingLookup(ix.document, l.core.id).length)}</span
						>
					</span>
					<span class="block truncate text-[11.5px] text-muted-foreground"
						>{preview(l.core.values)}</span
					>
				</span>
				<ChevronRight class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
			</button>
		{:else}
			<p class="text-[12px] text-muted-foreground">This process has no lookups of its own yet.</p>
		{/each}
		{#if edit}
			<form
				class="flex items-center gap-1.5 rounded-lg border border-dashed px-2 focus-within:border-solid focus-within:border-brand-ring"
				onsubmit={add}
			>
				<Plus class="size-3.5 shrink-0 text-muted-foreground" />
				<input
					class="h-8 min-w-0 flex-1 bg-transparent px-1 text-[13px] outline-none placeholder:text-muted-foreground"
					placeholder="New lookup, such as Document types"
					aria-label="Name of a new lookup"
					bind:value={name}
					onkeydown={(e) => e.stopPropagation()}
				/>
				<button
					class="h-7 shrink-0 cursor-pointer rounded-md px-2 text-[12px] font-medium text-brand hover:bg-brand-soft disabled:opacity-45"
					disabled={!name.trim()}>Add</button
				>
			</form>
		{/if}
	</Group>
	<Group title="Shared with this workspace" count={shared.length}>
		{#each shared as l (l.id)}
			<a
				href={manage(l.id)}
				class="flex items-start gap-2.5 rounded-lg border px-3 py-2 hover:border-brand-ring hover:bg-brand-soft/40"
			>
				<ListChecks class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
				<span class="min-w-0 flex-1">
					<span class="flex items-baseline gap-2">
						<span class="truncate text-[13px] font-medium">{l.title}</span>
						<span class="ml-auto shrink-0 text-[11px] text-muted-foreground"
							>{uses(factsUsingShared(ix.document, l.name).length)}</span
						>
					</span>
					<span class="block truncate text-[11.5px] text-muted-foreground"
						>{l.values.length} values · kept in {l.namespace}</span
					>
				</span>
				<ExternalLink class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
			</a>
		{:else}
			<p class="text-[12px] text-muted-foreground">
				No shared lookups yet. Shared lookups, such as countries, are kept for a whole workspace.
			</p>
		{/each}
		<a
			href={manage()}
			class="self-start text-[11.5px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
			>Manage shared lookups</a
		>
	</Group>
</div>
