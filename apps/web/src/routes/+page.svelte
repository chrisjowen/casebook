<script lang="ts">
	// Definition editor, phase 1: view and inspect process definitions. No cases or instances.
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import type { FactNode } from '@casebook/model';
	import TopBar from '$lib/editor/TopBar.svelte';
	import IconRail, { type RailItem } from '$lib/editor/IconRail.svelte';
	import Outline from '$lib/editor/Outline.svelte';
	import Segmented from '$lib/editor/Segmented.svelte';
	import Legend from '$lib/editor/Legend.svelte';
	import GraphCanvas from '$lib/graph/GraphCanvas.svelte';
	import StepInspector from '$lib/inspector/StepInspector.svelte';
	import FactInspector from '$lib/inspector/FactInspector.svelte';
	import ProcessInspector from '$lib/inspector/ProcessInspector.svelte';
	import SharedFactsInspector from '$lib/inspector/SharedFactsInspector.svelte';
	import {
		indexDocument,
		labelOf,
		processLinks,
		sharedFactTypes,
		type WorkItem
	} from '$lib/graph/derive';
	import { build, buildMap, type ViewId } from '$lib/graph/layout';
	import {
		LayoutGrid,
		Rows3,
		Workflow,
		Network,
		X,
		Info,
		Eye,
		CircleCheck,
		CircleAlert
	} from '@lucide/svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const workspace = $derived(
		data.workspaces.find((w) => w.namespace === data.namespace) ?? data.workspaces[0]
	);
	const indexes = $derived(
		workspace ? workspace.definitions.map((d) => indexDocument(d.document)) : []
	);
	const shared = $derived(sharedFactTypes(indexes.map((ix) => ix.document)));
	const isMap = $derived(!data.slug);
	const active = $derived(indexes.find((ix) => ix.document.slug === data.slug) ?? indexes[0]);
	const loaded = $derived(
		workspace?.definitions.find((d) => d.document.slug === active?.document.slug)
	);
	const selected = $derived(data.selected);
	const selectedNode = $derived(
		selected && selected !== 'shared' ? active?.byId.get(selected) : undefined
	);
	const selectedItem = $derived(
		selectedNode?.core.kind === 'step' || selectedNode?.core.kind === 'decision'
			? (selectedNode as WorkItem)
			: undefined
	);
	const selectedFact = $derived(
		selectedNode?.core.kind === 'fact' ? (selectedNode as FactNode) : undefined
	);

	let query = $state('');
	let outline = $state(true);
	let details = $state(false);
	let focusId = $state<string | undefined>();
	const inspectorOpen = $derived(
		!!selectedItem || !!selectedFact || selected === 'shared' || (details && !isMap)
	);

	function nav(next: Record<string, string | undefined>) {
		const params = new SvelteURLSearchParams(page.url.searchParams);
		for (const [key, value] of Object.entries(next)) {
			if (value === undefined) params.delete(key);
			else params.set(key, value);
		}
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- query-only update of this route
		goto(`?${params}`, { replaceState: true, keepFocus: true, noScroll: true });
	}

	function onselect(type: string, id: string) {
		if (type === 'pane') nav({ sel: undefined });
		else if (type === 'process') nav({ p: id, sel: undefined });
		else if (type === 'shared') nav({ sel: 'shared' });
		else if (type === 'fact') nav({ sel: id.replace(/^fact:/, '') });
		else nav({ sel: id });
	}

	const actions = {
		inspect: (id: string) => nav({ sel: id })
	};

	function onrail(item: RailItem) {
		const slug = data.slug ?? indexes[0]?.document.slug;
		if (item === 'map') nav({ p: 'map', sel: undefined });
		else if (item === 'facts') nav({ sel: 'shared' });
		else {
			details = item === 'roles';
			nav({ p: slug, sel: undefined });
		}
	}

	const views = [
		{ value: 'cards' as const, label: 'Step cards', icon: LayoutGrid },
		{ value: 'lanes' as const, label: 'Role lanes', icon: Rows3 },
		{ value: 'facts' as const, label: 'Fact flow', icon: Workflow }
	];
	const canvasSelection = $derived(
		selected === 'shared'
			? 'shared'
			: selectedFact && data.view === 'facts'
				? `fact:${selectedFact.core.id}`
				: selected
	);
	const layoutKey = $derived(
		isMap ? `map:${workspace?.namespace}` : `${active?.document.slug}:${data.view}`
	);
	const load = () => (isMap ? buildMap(indexes) : build(data.view as ViewId, active!));
	const failing = $derived(
		loaded ? loaded.errors.length + loaded.issues.filter((i) => i.severity === 'error').length : 0
	);
</script>

<svelte:head
	><title>{isMap ? 'Process map' : labelOf(active, active?.process?.core.id)} · casebook</title
	></svelte:head
>

<div class="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
	<TopBar bind:query />

	{#if !workspace || !active}
		<p class="m-auto text-[13px] text-muted-foreground">No process definitions yet.</p>
	{:else}
		<div class="flex min-h-0 flex-1">
			<IconRail
				active={selected === 'shared' ? 'facts' : isMap ? 'map' : details ? 'roles' : 'graph'}
				bind:outline
				onpick={onrail}
			/>
			{#if outline}
				<Outline
					workspaces={data.workspaces}
					{workspace}
					{indexes}
					{shared}
					activeSlug={data.slug}
					selectedId={selected}
					onworkspace={(namespace) => nav({ ws: namespace, p: undefined, sel: undefined })}
					onprocess={(slug) => nav({ p: slug, sel: undefined })}
					onitem={(slug, id) => {
						focusId = id;
						nav({ p: slug, sel: id });
					}}
					onmap={() => nav({ p: 'map', sel: undefined })}
					onshared={() => nav({ sel: 'shared' })}
				/>
			{/if}

			<section class="flex min-w-0 flex-1 flex-col">
				<div class="flex h-12 shrink-0 items-center gap-2 border-b bg-background px-3">
					<div
						class="no-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
						role="tablist"
						aria-label="Open views"
					>
						<button
							role="tab"
							aria-selected={isMap}
							class={[
								'inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px]',
								isMap
									? 'bg-background font-medium shadow-xs'
									: 'border-transparent text-muted-foreground hover:text-foreground'
							]}
							onclick={() => nav({ p: 'map', sel: undefined })}
							><Network class="size-3.5" />Process map</button
						>
						{#each indexes as ix (ix.document.slug)}
							<button
								role="tab"
								aria-selected={!isMap && ix === active}
								class={[
									'inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px]',
									!isMap && ix === active
										? 'bg-background font-medium shadow-xs'
										: 'border-transparent text-muted-foreground hover:text-foreground'
								]}
								onclick={() => nav({ p: ix.document.slug, sel: undefined })}
								><Workflow class="size-3.5 text-brand" />{labelOf(ix, ix.process?.core.id)}</button
							>
						{/each}
					</div>
					{#if !isMap}
						<Segmented
							label="Graph view"
							value={data.view}
							options={views}
							onchange={(view) => nav({ view })}
						/>
						<button
							class={[
								'flex size-8 cursor-pointer items-center justify-center rounded-lg border',
								details ? 'bg-muted' : 'hover:bg-muted'
							]}
							title="Process details and publish checks"
							aria-label="Process details and publish checks"
							aria-pressed={details}
							onclick={() => {
								details = !details;
								nav({ sel: undefined });
							}}><Info class="size-4" /></button
						>
					{/if}
				</div>

				<main class="relative min-h-0 flex-1">
					<GraphCanvas
						{layoutKey}
						{load}
						{onselect}
						{actions}
						{query}
						{focusId}
						selectedId={canvasSelection}
						readableZoom={isMap ? undefined : data.view === 'facts' ? 0.7 : 0.82}
					>
						{#snippet legend()}{#if !isMap}<Legend facts={data.view === 'facts'} />{/if}{/snippet}
					</GraphCanvas>
				</main>

				<footer
					class="flex h-8 shrink-0 items-center gap-4 overflow-hidden border-t bg-background px-4 text-[11.5px] whitespace-nowrap text-muted-foreground"
				>
					<span
						class="inline-flex items-center gap-1.5 rounded-md bg-brand-soft px-1.5 py-0.5 font-medium text-brand"
						><Eye class="size-3" />Viewing definitions</span
					>
					{#if isMap}
						<span>{indexes.length} {indexes.length === 1 ? 'process' : 'processes'}</span>
						<span>{processLinks(indexes.map((ix) => ix.document)).length} links</span>
						<span>{shared.length} shared fact types</span>
					{:else}
						<span
							>{active.work.length} steps and decisions · {active.stages.length} stages · {active
								.facts.length} fact types · {active.roles.length} roles</span
						>
						{#if failing}<span class="inline-flex items-center gap-1 text-destructive"
								><CircleAlert class="size-3" />{failing} publish {failing === 1
									? 'problem'
									: 'problems'}</span
							>
						{:else}<span class="inline-flex items-center gap-1 text-emerald-700"
								><CircleCheck class="size-3" />Publish checks pass</span
							>{/if}
						<span>Version {active.document.version}</span>
					{/if}
					<span class="ml-auto truncate">Workspace: {workspace.label}</span>
				</footer>
			</section>

			{#if inspectorOpen}
				<aside
					class="flex w-[360px] shrink-0 flex-col border-l bg-background"
					aria-label="Inspector"
				>
					<div class="flex h-12 shrink-0 items-center gap-2 border-b px-5">
						<span
							class="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
						>
							{selectedItem
								? selectedItem.core.kind === 'decision'
									? 'Decision'
									: 'Step'
								: selectedFact
									? 'Fact type'
									: selected === 'shared'
										? 'Workspace'
										: 'Process'}
						</span>
						<h2 class="truncate text-[13.5px] font-semibold">
							{selectedNode
								? labelOf(active, selectedNode.core.id)
								: selected === 'shared'
									? 'Shared fact types'
									: labelOf(active, active.process?.core.id)}
						</h2>
						<button
							class="ml-auto flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
							aria-label="Close inspector"
							onclick={() => {
								details = false;
								nav({ sel: undefined });
							}}><X class="size-4" /></button
						>
					</div>
					<div class="no-scrollbar min-h-0 flex-1 overflow-y-auto">
						{#if selectedItem}
							<StepInspector ix={active} item={selectedItem} onfact={(id) => nav({ sel: id })} />
						{:else if selectedFact}
							<FactInspector ix={active} fact={selectedFact} />
						{:else if selected === 'shared'}
							<SharedFactsInspector {shared} />
						{:else if loaded}
							<ProcessInspector ix={active} {loaded} />
						{/if}
					</div>
				</aside>
			{/if}
		</div>
	{/if}
</div>
