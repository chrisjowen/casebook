<script lang="ts">
	// Definition editor, a process's Edit tab inside the app shell: build, view and publish process
	// definitions stored in Postgres, as the signed-in user. A process is built on the board; role
	// lanes and fact flow are read-only lenses on it, and the process map shows a workspace's
	// processes. Edits are draft revisions; governed processes publish explicitly, living ones
	// publish every edit. New processes and imports start from the shell's New menu.
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import {
		factsUsingShared,
		type FactNode,
		type LookupNode,
		type Operation,
		type StageId
	} from '@casebook/model';
	import { Editor, setEditor } from '$lib/editor/editing.svelte';
	import { shareLookup, type Edit } from '$lib/editor/ops';
	import { deserialize } from '$app/forms';
	import { draftStatus, publishBlocked } from '$lib/editor/status';
	import Frame, { type Crumb } from '$lib/runner/Frame.svelte';
	import { links } from '$lib/runner/links';
	import ProcessActions from '$lib/shell/ProcessActions.svelte';
	import { processTabs } from '$lib/shell/process';
	import Segmented from '$lib/editor/Segmented.svelte';
	import Legend from '$lib/editor/Legend.svelte';
	import GraphCanvas from '$lib/graph/GraphCanvas.svelte';
	import Board from '$lib/graph/Board.svelte';
	import StepInspector from '$lib/inspector/StepInspector.svelte';
	import StageInspector from '$lib/inspector/StageInspector.svelte';
	import FactInspector from '$lib/inspector/FactInspector.svelte';
	import ProcessInspector from '$lib/inspector/ProcessInspector.svelte';
	import SharedFactsInspector from '$lib/inspector/SharedFactsInspector.svelte';
	import LookupInspector from '$lib/inspector/LookupInspector.svelte';
	import LookupsInspector from '$lib/inspector/LookupsInspector.svelte';
	import Assistant from '$lib/wizard/Assistant.svelte';
	import { inspector } from '$lib/conditions/layout.svelte';
	import * as Select from '$lib/components/ui/select';
	import {
		indexDocument,
		labelOf,
		plainText,
		processLinks,
		sharedFactTypes,
		type WorkItem
	} from '$lib/graph/derive';
	import { build, buildMap } from '$lib/graph/layout';
	import Columns3 from '@lucide/svelte/icons/columns-3';
	import Rows3 from '@lucide/svelte/icons/rows-3';
	import Workflow from '@lucide/svelte/icons/workflow';
	import Network from '@lucide/svelte/icons/network';
	import Info from '@lucide/svelte/icons/info';
	import Eye from '@lucide/svelte/icons/eye';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import SquarePen from '@lucide/svelte/icons/square-pen';
	import Upload from '@lucide/svelte/icons/upload';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import Play from '@lucide/svelte/icons/play';
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import FileSpreadsheet from '@lucide/svelte/icons/file-spreadsheet';
	import Search from '@lucide/svelte/icons/search';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import X from '@lucide/svelte/icons/x';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const workspace = $derived(
		data.workspaces.find((w) => w.namespace === data.namespace) ?? data.workspaces[0]
	);
	// The shared lookups the workspace's processes choose from, by the name facts use (ADR 0025).
	const sharedLookups = $derived(
		new Map(workspace?.lookups.map((l) => [l.name, { title: l.title, values: l.values }]) ?? [])
	);
	const indexes = $derived(
		workspace ? workspace.definitions.map((d) => indexDocument(d.document, sharedLookups)) : []
	);
	const manageLookups = (id?: string) => links.lookups(data.instance.slug, id);
	const shared = $derived(sharedFactTypes(indexes.map((ix) => ix.document)));
	const isMap = $derived(!data.slug);
	const active = $derived(indexes.find((ix) => ix.document.slug === data.slug) ?? indexes[0]);
	// The process's own lookups and the shared ones its facts choose from.
	const lookupsInUse = $derived(
		active
			? active.lookups.length +
					(workspace?.lookups.filter((l) => factsUsingShared(active.document, l.name).length)
						.length ?? 0)
			: 0
	);
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
	const selectedStage = $derived(
		selectedNode?.core.kind === 'stage' ? (selectedNode.core.id as StageId) : undefined
	);
	const selectedLookup = $derived(
		selectedNode?.core.kind === 'lookup' ? (selectedNode as LookupNode) : undefined
	);

	// A spreadsheet import in progress: its assistant, and its pending proposal on the open process,
	// which the board shows in place of the draft until it is accepted or rejected.
	const wizard = $derived(data.wizard);
	const proposal = $derived(wizard?.preview?.ok ? wizard.preview : undefined);
	const boardIx = $derived(proposal ? indexDocument(proposal.document) : active);
	const imported = $derived(new Map(wizard?.state.processes.map((p) => [p.slug, p]) ?? []));
	/** Still choosing how to split the workbook: no process is open yet, so none is named. */
	const splitting = $derived(wizard?.state.phase === 'split');
	let assistantOpen = $state(true);

	const editor = new Editor(() => loaded);
	setEditor(editor);
	/** Saves operations as an edit of the open draft, or is absent when the user cannot edit it. */
	const edit = $derived(
		editor.blocked === undefined ? (ops: Operation[]) => editor.apply(ops) : undefined
	);
	/** Saves one gesture's edit with its notice and selects what it made, or shows why not. */
	const change = $derived(
		editor.blocked === undefined
			? async (e: Edit | string) => {
					if (typeof e === 'string') {
						editor.refuse(e);
						return false;
					}
					const ok = await editor.apply(e.ops, e.label);
					if (ok && e.select) nav({ sel: e.select });
					return ok;
				}
			: undefined
	);
	const publishProblem = $derived(loaded && publishBlocked(loaded));

	/**
	 * Moves a process lookup to the workspace's shared lookups: makes the shared one, then points
	 * the facts at it and drops the process's copy in one edit of the draft.
	 */
	async function share(lookup: LookupNode) {
		if (!workspace || !active || !change) return;
		const body = new FormData();
		body.set('namespaceId', workspace.id);
		body.set('title', labelOf(active, lookup.core.id));
		body.set('values', JSON.stringify(lookup.core.values));
		const response = await fetch(`${manageLookups()}?/share`, {
			method: 'POST',
			body,
			headers: { 'x-sveltekit-action': 'true' }
		});
		const result = deserialize(await response.text());
		if (result.type !== 'success') {
			editor.refuse(
				result.type === 'failure'
					? String((result.data as { reason?: string } | undefined)?.reason ?? 'It was not shared')
					: 'It was not shared'
			);
			return;
		}
		const made = result.data as { id: string; name: string };
		if (await change(shareLookup(active, lookup.core.id, made.name))) {
			nav({ sel: 'lookups' });
			return;
		}
		const undo = new FormData();
		undo.set('lookupId', made.id);
		await fetch(`${manageLookups()}?/delete`, {
			method: 'POST',
			body: undo,
			headers: { 'x-sveltekit-action': 'true' }
		});
	}

	let query = $state('');
	let details = $state(false);
	const inspectorOpen = $derived(
		!!selectedItem ||
			!!selectedFact ||
			!!selectedStage ||
			!!selectedLookup ||
			selected === 'lookups' ||
			selected === 'shared' ||
			(details && !isMap)
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

	const views = [
		{ value: 'board' as const, label: 'Board', icon: Columns3 },
		{ value: 'lanes' as const, label: 'Role lanes', icon: Rows3 },
		{ value: 'facts' as const, label: 'Fact flow', icon: Workflow }
	];
	const onBoard = $derived(!isMap && data.view === 'board');
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
	const load = () =>
		isMap || data.view === 'board'
			? buildMap(indexes)
			: build(data.view as 'lanes' | 'facts', active!);
	const failing = $derived(
		loaded ? loaded.errors.length + loaded.issues.filter((i) => i.severity === 'error').length : 0
	);
	const warnings = $derived(
		loaded ? loaded.issues.filter((i) => i.severity === 'warning').length : 0
	);
	const crumbs = $derived<Crumb[]>(
		splitting
			? [{ label: `Import ${wizard!.fileName}` }]
			: isMap || !active
				? [{ label: `Process map · ${workspace?.label ?? ''}` }]
				: [
						{
							label: labelOf(active, active.process?.core.id),
							...(data.instance
								? { href: links.process(data.instance.slug, active.document.slug) }
								: {})
						},
						{ label: loaded?.can.edit.allowed ? 'Edit' : 'Board' }
					]
	);
	const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
	const tab =
		'inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px]';
</script>

<svelte:head
	><title
		>{splitting
			? `Import ${wizard!.fileName} · ${data.instance.name}`
			: isMap || !active
				? `Process map · ${data.instance.name}`
				: `Edit · ${labelOf(active, active.process?.core.id)}`}</title
	></svelte:head
>

<Frame
	user={data.user}
	instance={data.instance}
	instances={data.instances}
	fill
	{crumbs}
	tabs={!isMap && !splitting && loaded && data.instance
		? processTabs(
				data.instance.slug,
				{
					slug: loaded.document.slug,
					namespace: workspace!.namespace,
					canEdit: loaded.can.edit.allowed
				},
				'edit'
			)
		: undefined}
>
	{#snippet actions()}
		{#if !isMap && !splitting && loaded && data.instance && workspace}
			<ProcessActions
				instance={data.instance.slug}
				process={{
					slug: loaded.document.slug,
					namespace: workspace.namespace,
					status: loaded.published ? 'published' : 'draft',
					canEdit: loaded.can.edit
				}}
				title={labelOf(active!, active!.process?.core.id)}
				omit={['edit']}
			/>
		{/if}
	{/snippet}

	{#if !workspace}
		<p class="m-auto max-w-sm text-center text-[13px] text-muted-foreground">
			{data.user.displayName} cannot read any namespace yet. Ask an account owner for access, or sign
			in as another demo user.
		</p>
	{:else}
		<div class="flex min-h-0 flex-1 bg-background">
			<section class="flex min-w-0 flex-1 flex-col">
				<div
					class={[
						'no-scrollbar flex h-12 shrink-0 items-center gap-2 overflow-x-auto border-b bg-background px-3',
						splitting && assistantOpen && 'hidden'
					]}
				>
					{#if isMap}
						<Select.Root
							type="single"
							value={workspace.namespace}
							onValueChange={(namespace) =>
								nav({ ws: namespace, p: 'map', sel: undefined, wizard: undefined })}
						>
							<Select.Trigger
								class="h-8 w-44 shrink-0 rounded-lg text-[12.5px] font-medium"
								aria-label="Workspace">{workspace.label}</Select.Trigger
							>
							<Select.Content>
								{#each data.workspaces as w (w.namespace)}<Select.Item
										value={w.namespace}
										label={w.label}
										>{w.label}<span class="ml-auto pl-3 text-[11px] text-muted-foreground"
											>{w.namespace}</span
										></Select.Item
									>{/each}
							</Select.Content>
						</Select.Root>
						<span class="flex items-center gap-1.5 text-[12.5px] text-muted-foreground"
							><Network class="size-3.5" />How the processes here hand facts to each other</span
						>
					{/if}
					{#if !splitting}
						<label
							class="flex h-8 w-56 min-w-0 shrink items-center gap-2 rounded-lg bg-muted/70 px-2.5 text-[12.5px] text-muted-foreground focus-within:ring-2 focus-within:ring-brand-ring"
						>
							<Search class="size-3.5 shrink-0" />
							<input
								bind:value={query}
								placeholder={isMap ? 'Find a process or fact' : 'Find on the board'}
								aria-label="Find on the board"
								class="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
							/>
						</label>
					{/if}
					{#if wizard}
						<!-- While an import drafts several processes, hop between them here. -->
						<div
							class="no-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
							role="tablist"
							aria-label="Imported processes"
						>
							{#each indexes.filter( (ix) => imported.has(ix.document.slug) ) as ix (ix.document.slug)}
								<button
									role="tab"
									aria-selected={!isMap && ix === active}
									class={[
										tab,
										!isMap && ix === active
											? 'bg-background font-medium shadow-xs'
											: 'border-transparent text-muted-foreground hover:text-foreground'
									]}
									onclick={() => nav({ p: ix.document.slug, sel: undefined })}
									><Workflow class="size-3.5 text-brand" />{labelOf(
										ix,
										ix.process?.core.id
									)}{#if !imported.get(ix.document.slug)?.drafted}<span
											class="text-[11px] font-normal text-muted-foreground">· not drafted</span
										>{/if}</button
								>
							{/each}
						</div>
					{:else}
						<span class="flex-1"></span>
					{/if}
					{#if wizard && !assistantOpen}
						<button
							class="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px] font-medium hover:bg-muted"
							onclick={() => (assistantOpen = true)}><Sparkles class="size-3.5" />Assistant</button
						>
					{/if}
					{#if !isMap && !splitting && active && loaded}
						<Segmented
							label="View"
							value={data.view}
							options={views}
							onchange={(view) => nav({ view })}
						/>
						{#if loaded.policy === 'governed' && loaded.can.edit.allowed}
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
								'flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border',
								details ? 'bg-muted' : 'hover:bg-muted'
							]}
							title="Process details, publishing, checks and facts"
							aria-label="Process details, publishing, checks and facts"
							aria-pressed={details}
							onclick={() => {
								details = !details;
								nav({ sel: undefined });
							}}><Info class="size-4" /></button
						>
					{/if}
				</div>
				<div class="relative min-h-0 flex-1">
					{#if wizard?.state.phase === 'split'}
						<div
							class="absolute inset-0 m-auto flex h-fit w-[min(384px,calc(100%-32px))] flex-col items-center gap-2 rounded-2xl border border-dashed bg-background p-8 text-center"
							style:transform={assistantOpen ? 'translateX(-200px)' : undefined}
						>
							<FileSpreadsheet class="size-5 text-muted-foreground" />
							<p class="text-[14px] font-medium">Choose the processes</p>
							<p class="text-[12.5px] text-muted-foreground">
								The assistant suggests how to split {wizard.fileName} into processes. Rename, merge or
								split them in the assistant panel, then accept the split to draft them here.
							</p>
						</div>
					{:else if active && boardIx}
						{#if onBoard}
							<Board
								ix={boardIx}
								marks={proposal?.marks}
								editable={editor.blocked === undefined && !proposal}
								selectedId={selected === 'shared' ? undefined : selected}
								onselect={(id) => nav({ sel: id })}
								{query}
							>
								{#snippet legend()}<Legend facts={false} />{/snippet}
							</Board>
						{:else}
							<GraphCanvas
								{layoutKey}
								{load}
								{onselect}
								{query}
								selectedId={canvasSelection}
								readableZoom={isMap ? undefined : data.view === 'facts' ? 0.7 : 0.82}
							>
								{#snippet legend()}{#if !isMap}<Legend
											facts={data.view === 'facts'}
										/>{/if}{/snippet}
							</GraphCanvas>
						{/if}
					{:else}
						<p class="absolute inset-0 m-auto h-fit text-center text-[13px] text-muted-foreground">
							No processes in {workspace.namespace} yet.{#if workspace.can.create.allowed}
								Use New, then New process, to start one.{/if}
						</p>
					{/if}
					{#if wizard}
						<Assistant
							view={wizard}
							open={assistantOpen}
							openSlug={isMap ? undefined : data.slug}
							openRevision={loaded?.revision}
							onclose={() => (assistantOpen = false)}
							onopen={(slug) => nav({ p: slug, sel: undefined, view: undefined })}
						/>
					{/if}
					{#if editor.notice}
						<div
							role={editor.notice.tone === 'info' ? 'status' : 'alert'}
							class={[
								'absolute top-3 left-1/2 z-40 flex w-[min(600px,calc(100%-24px))] -translate-x-1/2 items-start gap-2 rounded-xl border bg-background px-3.5 py-2.5 text-[12.5px] shadow-md',
								editor.notice.tone === 'error' && 'border-destructive/40',
								editor.notice.tone === 'warn' && 'border-amber-300 bg-amber-50'
							]}
						>
							{#if editor.notice.tone === 'error'}<CircleAlert
									class="mt-0.5 size-3.5 shrink-0 text-destructive"
								/>{:else if editor.notice.tone === 'warn'}<TriangleAlert
									class="mt-0.5 size-3.5 shrink-0 text-amber-600"
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
							{#if editor.notice.published && loaded}
								<a
									href={links.newCase(data.instance.slug, { process: loaded.document.slug })}
									class="-my-1 inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 font-medium text-brand hover:bg-brand-soft"
									><Play class="size-3.5" />Start a case</a
								>
							{/if}
							{#if editor.notice.undo && editor.undoable}
								<button
									class="-my-1 inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-lg px-2 py-1 font-medium text-brand hover:bg-brand-soft"
									onclick={() => editor.undo()}><Undo2 class="size-3.5" />Undo</button
								>
							{/if}
							<button
								class="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
								aria-label="Dismiss"
								onclick={() => editor.dismiss()}><X class="size-3.5" /></button
							>
						</div>
					{/if}
				</div>

				<footer
					class="flex h-8 shrink-0 items-center gap-4 overflow-hidden border-t bg-background px-4 text-[11.5px] whitespace-nowrap text-muted-foreground"
				>
					{#if splitting}
						<span
							class="inline-flex items-center gap-1.5 rounded-md bg-brand-soft px-1.5 py-0.5 font-medium text-brand"
							><FileSpreadsheet class="size-3" />Importing {wizard!.fileName}</span
						>
					{:else if !isMap && loaded && !editor.blocked}
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
					{#if splitting}
						<span>Nothing is created until you accept the split</span>
					{:else if isMap}
						<span>{indexes.length} {indexes.length === 1 ? 'process' : 'processes'}</span>
						<span>{processLinks(indexes.map((ix) => ix.document)).length} links</span>
						<button
							class="cursor-pointer hover:text-foreground"
							onclick={() => nav({ sel: 'shared' })}>{shared.length} shared fact types</button
						>
					{:else if active}
						<span
							>{[
								count(active.work.length, 'step or decision', 'steps and decisions'),
								count(active.stages.length, 'stage'),
								count(active.facts.length, 'fact type'),
								count(active.roles.length, 'role')
							].join(' · ')}</span
						>
						<button
							class="cursor-pointer hover:text-foreground"
							title="Lists of values that choices are made from"
							onclick={() => nav({ sel: 'lookups' })}
							>{lookupsInUse}
							{lookupsInUse === 1 ? 'lookup' : 'lookups'}</button
						>
						{#if failing}<button
								class="inline-flex cursor-pointer items-center gap-1 text-destructive"
								onclick={() => {
									details = true;
									nav({ sel: undefined });
								}}
								><CircleAlert class="size-3" />{failing} publish {failing === 1
									? 'problem'
									: 'problems'}</button
							>
						{:else if warnings}<button
								class="inline-flex cursor-pointer items-center gap-1 text-amber-700"
								title="Publishing is allowed; open the details to see what to look at"
								onclick={() => {
									details = true;
									nav({ sel: undefined });
								}}
								><TriangleAlert class="size-3" />Publish checks pass · {warnings}
								{warnings === 1 ? 'warning' : 'warnings'}</button
							>
						{:else}<span class="inline-flex items-center gap-1 text-emerald-700"
								><CircleCheck class="size-3" />Publish checks pass</span
							>{/if}
						{#if loaded}<span
								>{`${loaded.policy === 'living' ? 'Living' : 'Draft'} · ${draftStatus(loaded)}`}</span
							>{/if}
					{/if}
					<span class="ml-auto truncate" title={workspace.namespace}>{workspace.label}</span>
				</footer>
			</section>

			{#if inspectorOpen && active}
				<aside
					class={[
						'flex shrink-0 flex-col border-l bg-background',
						inspector.wide ? 'w-[min(560px,48vw)]' : 'w-[372px]'
					]}
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
									: selectedStage
										? 'Stage'
										: selectedLookup
											? 'Lookup'
											: selected === 'shared'
												? 'Workspace'
												: 'Process'}
						</span>
						<h2 class="truncate text-[13.5px] font-semibold">
							{selectedNode
								? labelOf(active, selectedNode.core.id)
								: selected === 'shared'
									? 'Shared fact types'
									: selected === 'lookups'
										? 'Lookups'
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
						<!-- The store's reason names roles and namespaces; say it plainly, keep it as a tooltip. -->
						<p
							class="border-b bg-muted/40 px-5 py-2 text-[11.5px] text-muted-foreground"
							title={editor.blocked}
						>
							{loaded && !loaded.can.edit.allowed
								? `You can view this process. To change it, ask someone who can edit processes in ${workspace.label}.`
								: editor.blocked}
						</p>
					{/if}
					<div class="no-scrollbar min-h-0 flex-1 overflow-y-auto">
						{#if selectedItem}
							{#key selectedItem.core.id}
								<StepInspector
									ix={active}
									item={selectedItem}
									onselect={(id) => nav({ sel: id })}
									edit={change}
									publishes={loaded?.policy === 'living'}
								/>
							{/key}
						{:else if selectedStage}
							<StageInspector
								ix={active}
								stage={selectedStage}
								onselect={(id) => nav({ sel: id })}
								edit={change}
							/>
						{:else if selectedFact}
							<FactInspector
								ix={active}
								fact={selectedFact}
								{edit}
								{change}
								shared={workspace.lookups}
								manage={manageLookups}
								onselect={(id) => nav({ sel: id })}
								onremoved={() => nav({ sel: undefined })}
							/>
						{:else if selectedLookup}
							{#key selectedLookup.core.id}
								<LookupInspector
									ix={active}
									lookup={selectedLookup}
									edit={change}
									onselect={(id) => nav({ sel: id })}
									onremoved={() => nav({ sel: 'lookups' })}
									share={change && workspace.can.create.allowed
										? () => share(selectedLookup)
										: undefined}
								/>
							{/key}
						{:else if selected === 'lookups'}
							<LookupsInspector
								ix={active}
								shared={workspace.lookups}
								edit={change}
								onselect={(id) => nav({ sel: id })}
								manage={manageLookups}
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
</Frame>
