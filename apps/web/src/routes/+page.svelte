<script lang="ts">
	// Definition editor: view, inspect and edit process definitions stored in Postgres, as the
	// signed-in user. Edits are draft revisions; governed processes publish explicitly, living ones
	// publish every edit. No cases or instances.
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import type { FactNode, Operation } from '@casebook/model';
	import { Editor, setEditor } from '$lib/editor/editing.svelte';
	import * as edits from '$lib/editor/ops';
	import { draftStatus, publishBlocked } from '$lib/editor/status';
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
		plainText,
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
		CircleAlert,
		SquarePen,
		Upload,
		LoaderCircle
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

	const editor = new Editor(() => loaded);
	setEditor(editor);
	/** Saves an edit of the open draft, or is absent when the user cannot edit it. */
	const edit = $derived(
		editor.blocked === undefined ? (ops: Operation[]) => editor.apply(ops) : undefined
	);
	async function run({ ops, select }: edits.Edit) {
		if ((await editor.apply(ops)) && select) nav({ sel: select });
	}
	const publishProblem = $derived(loaded && publishBlocked(loaded));

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
		inspect: (id: string) => nav({ sel: id }),
		get blocked() {
			return editor.blocked;
		},
		edits: {
			addStep: (id: string) => run(edits.addStepAfter(active!.document, id)),
			addFact: (id: string) => run(edits.addFact(active!.document, id)),
			addCondition: (id: string) => run(edits.addCondition(active!.document, id)),
			duplicate: (id: string) => run(edits.duplicate(active!.document, id)),
			remove: async (id: string) => {
				if ((await editor.apply(edits.remove(id).ops)) && selected === id) nav({ sel: undefined });
			}
		}
	};

	async function create(title: string, changePolicy: 'governed' | 'living') {
		if (!workspace) return;
		const slug = await editor.create(workspace.id, title, changePolicy);
		if (slug) {
			details = true;
			nav({ ws: workspace.namespace, p: slug, sel: undefined });
		}
	}

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
		isMap
			? `map:${workspace?.namespace}:${workspace?.definitions.map((d) => d.revision).join(',')}`
			: `${active?.document.slug}:${data.view}:${loaded?.revision}`
	);
	const load = () => (isMap ? buildMap(indexes) : build(data.view as ViewId, active!));
	const failing = $derived(
		loaded ? loaded.errors.length + loaded.issues.filter((i) => i.severity === 'error').length : 0
	);
</script>

<svelte:head
	><title
		>{isMap || !active ? 'Process map' : labelOf(active, active.process?.core.id)} · casebook</title
	></svelte:head
>

<div class="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
	<TopBar bind:query user={data.user} />

	{#if !workspace}
		<p class="m-auto max-w-sm text-center text-[13px] text-muted-foreground">
			{data.user.displayName} cannot read any namespace yet. Ask an account owner for access, or sign
			in as another demo user.
		</p>
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
					oncreate={create}
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
					{#if !isMap && active && loaded}
						<Segmented
							label="Graph view"
							value={data.view}
							options={views}
							onchange={(view) => nav({ view })}
						/>
						{#if loaded.policy === 'governed'}
							<button
								class="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-brand px-2.5 text-[12.5px] font-medium text-white enabled:cursor-pointer enabled:hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
								disabled={!!publishProblem || editor.busy}
								title={publishProblem ??
									`Publish the draft as version ${(loaded.published?.version ?? 0) + 1}`}
								onclick={() => editor.publish()}
								>{#if editor.busy}<LoaderCircle class="size-3.5 animate-spin" />{:else}<Upload
										class="size-3.5"
									/>{/if}Publish</button
							>
						{/if}
						<button
							class={[
								'flex size-8 cursor-pointer items-center justify-center rounded-lg border',
								details ? 'bg-muted' : 'hover:bg-muted'
							]}
							title="Process details, publishing and checks"
							aria-label="Process details, publishing and checks"
							aria-pressed={details}
							onclick={() => {
								details = !details;
								nav({ sel: undefined });
							}}><Info class="size-4" /></button
						>
					{/if}
				</div>

				<main class="relative min-h-0 flex-1">
					{#if active}
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
					{:else}
						<p class="absolute inset-0 m-auto h-fit text-center text-[13px] text-muted-foreground">
							No processes in {workspace.namespace} yet.{#if workspace.can.create.allowed}
								Use + next to Processes to start one.{/if}
						</p>
					{/if}
					{#if editor.notice}
						<div
							role={editor.notice.tone === 'error' ? 'alert' : 'status'}
							class={[
								'absolute top-3 left-1/2 z-10 flex w-[min(560px,calc(100%-24px))] -translate-x-1/2 items-start gap-2 rounded-xl border bg-background px-3.5 py-2.5 text-[12.5px] shadow-md',
								editor.notice.tone === 'error' && 'border-destructive/40'
							]}
						>
							{#if editor.notice.tone === 'error'}<CircleAlert
									class="mt-0.5 size-3.5 shrink-0 text-destructive"
								/>{:else}<CircleCheck class="mt-0.5 size-3.5 shrink-0 text-emerald-600" />{/if}
							<div class="min-w-0 flex-1">
								<p>{active ? plainText(active, editor.notice.text) : editor.notice.text}</p>
								{#if editor.notice.details}
									<ul class="mt-1 flex flex-col gap-0.5 text-[11.5px] text-muted-foreground">
										{#each editor.notice.details as line, i (i)}<li>
												{active ? plainText(active, line) : line}
											</li>{/each}
									</ul>
								{/if}
							</div>
							<button
								class="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
								aria-label="Dismiss"
								onclick={() => editor.dismiss()}><X class="size-3.5" /></button
							>
						</div>
					{/if}
				</main>

				<footer
					class="flex h-8 shrink-0 items-center gap-4 overflow-hidden border-t bg-background px-4 text-[11.5px] whitespace-nowrap text-muted-foreground"
				>
					{#if !isMap && loaded && !editor.blocked}
						<span
							class="inline-flex items-center gap-1.5 rounded-md bg-brand-soft px-1.5 py-0.5 font-medium text-brand"
							><SquarePen class="size-3" />Editing draft</span
						>
					{:else}
						<span
							class="inline-flex items-center gap-1.5 rounded-md bg-brand-soft px-1.5 py-0.5 font-medium text-brand"
							title={isMap ? undefined : editor.blocked}
							><Eye class="size-3" />{isMap || !loaded ? 'Viewing definitions' : 'Read only'}</span
						>
					{/if}
					{#if isMap}
						<span>{indexes.length} {indexes.length === 1 ? 'process' : 'processes'}</span>
						<span>{processLinks(indexes.map((ix) => ix.document)).length} links</span>
						<span>{shared.length} shared fact types</span>
					{:else if active}
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
						{#if loaded}<span
								>{`${loaded.policy === 'living' ? 'Living' : 'Draft'} · ${draftStatus(loaded)}`}</span
							>{/if}
					{/if}
					<span class="ml-auto truncate">Workspace: {workspace.label} ({workspace.namespace})</span>
				</footer>
			</section>

			{#if inspectorOpen && active}
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
					{#if !isMap && editor.blocked && selected !== 'shared'}
						<p class="border-b bg-muted/40 px-5 py-2 text-[11.5px] text-muted-foreground">
							{editor.blocked}
						</p>
					{/if}
					<div class="no-scrollbar min-h-0 flex-1 overflow-y-auto">
						{#if selectedItem}
							<StepInspector
								ix={active}
								item={selectedItem}
								onfact={(id) => nav({ sel: id })}
								{edit}
							/>
						{:else if selectedFact}
							<FactInspector
								ix={active}
								fact={selectedFact}
								{edit}
								onremoved={() => nav({ sel: undefined })}
							/>
						{:else if selected === 'shared'}
							<SharedFactsInspector {shared} />
						{:else if loaded}
							<ProcessInspector ix={active} {loaded} {edit} onselect={(id) => nav({ sel: id })} />
						{/if}
					</div>
				</aside>
			{/if}
		</div>
	{/if}
</div>
