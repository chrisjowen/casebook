<script lang="ts">
	// Definition editor: build, view and publish process definitions stored in Postgres, as the
	// signed-in user. A process is built on the board; role lanes and fact flow are read-only
	// lenses on it, and the process map shows a workspace's processes. Edits are draft revisions;
	// governed processes publish explicitly, living ones publish every edit. No cases or instances.
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import type { FactNode, Operation, StageId } from '@casebook/model';
	import { Editor, setEditor } from '$lib/editor/editing.svelte';
	import type { Edit } from '$lib/editor/ops';
	import { draftStatus, publishBlocked } from '$lib/editor/status';
	import TopBar from '$lib/editor/TopBar.svelte';
	import Segmented from '$lib/editor/Segmented.svelte';
	import Legend from '$lib/editor/Legend.svelte';
	import GraphCanvas from '$lib/graph/GraphCanvas.svelte';
	import Board from '$lib/graph/Board.svelte';
	import StepInspector from '$lib/inspector/StepInspector.svelte';
	import StageInspector from '$lib/inspector/StageInspector.svelte';
	import FactInspector from '$lib/inspector/FactInspector.svelte';
	import ProcessInspector from '$lib/inspector/ProcessInspector.svelte';
	import SharedFactsInspector from '$lib/inspector/SharedFactsInspector.svelte';
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
	import {
		Columns3,
		Rows3,
		Workflow,
		Network,
		X,
		Info,
		Eye,
		CircleCheck,
		CircleAlert,
		TriangleAlert,
		SquarePen,
		Upload,
		LoaderCircle,
		Plus,
		Undo2,
		FileSpreadsheet,
		Sparkles,
		Download
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
	const selectedStage = $derived(
		selectedNode?.core.kind === 'stage' ? (selectedNode.core.id as StageId) : undefined
	);

	// A spreadsheet import in progress: its assistant, and its pending proposal on the open process,
	// which the board shows in place of the draft until it is accepted or rejected.
	const wizard = $derived(data.wizard);
	const proposal = $derived(wizard?.preview?.ok ? wizard.preview : undefined);
	const boardIx = $derived(proposal ? indexDocument(proposal.document) : active);
	const imported = $derived(new Map(wizard?.state.processes.map((p) => [p.slug, p]) ?? []));
	let assistantOpen = $state(true);
	let importing = $state(false);
	let importAt = $state(0);
	let importError = $state<string | undefined>();
	let uploading = $state(false);

	async function startImport(body: FormData) {
		if (!workspace) return;
		body.set('namespaceId', workspace.id);
		uploading = true;
		importError = undefined;
		try {
			const response = await fetch('/wizard', { method: 'POST', body });
			const result = await response.json();
			if (!result.ok) {
				importError = result.reason ?? 'The import did not start';
				return;
			}
			importing = false;
			assistantOpen = true;
			nav({ wizard: result.id, sel: undefined });
		} catch (error) {
			importError = error instanceof Error ? error.message : String(error);
		} finally {
			uploading = false;
		}
	}

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

	let query = $state('');
	let details = $state(false);
	let creating = $state(false);
	let createAt = $state(0);
	let newTitle = $state('');
	let newPolicy = $state<'governed' | 'living'>('governed');
	const inspectorOpen = $derived(
		!!selectedItem ||
			!!selectedFact ||
			!!selectedStage ||
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

	async function create(e: SubmitEvent) {
		e.preventDefault();
		if (!workspace || !newTitle.trim()) return;
		const slug = await editor.create(workspace.id, newTitle.trim(), newPolicy);
		if (slug) {
			creating = false;
			newTitle = '';
			nav({ ws: workspace.namespace, p: slug, sel: undefined, view: undefined });
		}
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
	const tab =
		'inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px]';
</script>

<svelte:head
	><title
		>{isMap || !active ? 'Process map' : labelOf(active, active.process?.core.id)} · casebook</title
	></svelte:head
>

<div class="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
	<TopBar bind:query user={data.user} instance={data.instance} />

	{#if !workspace}
		<p class="m-auto max-w-sm text-center text-[13px] text-muted-foreground">
			{data.user.displayName} cannot read any namespace yet. Ask an account owner for access, or sign
			in as another demo user.
		</p>
	{:else}
		<div class="flex min-h-0 flex-1">
			<section class="flex min-w-0 flex-1 flex-col">
				<div class="flex h-12 shrink-0 items-center gap-2 border-b bg-background px-3">
					<Select.Root
						type="single"
						value={workspace.namespace}
						onValueChange={(namespace) =>
							nav({ ws: namespace, p: undefined, sel: undefined, wizard: undefined })}
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
					<span class="h-5 w-px shrink-0 bg-border"></span>
					<div
						class="no-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
						role="tablist"
						aria-label="Processes"
					>
						<button
							role="tab"
							aria-selected={isMap}
							class={[
								tab,
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
									tab,
									!isMap && ix === active
										? 'bg-background font-medium shadow-xs'
										: 'border-transparent text-muted-foreground hover:text-foreground'
								]}
								onclick={() => nav({ p: ix.document.slug, sel: undefined })}
								><Workflow class="size-3.5 text-brand" />{labelOf(
									ix,
									ix.process?.core.id
								)}{#if imported.get(ix.document.slug) && !imported.get(ix.document.slug)?.drafted}<span
										class="text-[11px] font-normal text-muted-foreground">· not drafted</span
									>{/if}</button
							>
						{/each}
						<div class="relative shrink-0">
							<button
								class="flex size-8 items-center justify-center rounded-lg text-muted-foreground enabled:cursor-pointer enabled:hover:bg-muted enabled:hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
								title={workspace.can.create.allowed
									? 'New process'
									: `New process: ${workspace.can.create.reason}`}
								aria-label="New process"
								aria-expanded={creating}
								disabled={!workspace.can.create.allowed}
								onclick={(e) => {
									createAt = e.currentTarget.getBoundingClientRect().left;
									creating = !creating;
								}}><Plus class="size-4" /></button
							>
						</div>
						<button
							class="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-[12.5px] text-muted-foreground enabled:cursor-pointer enabled:hover:bg-muted enabled:hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
							title={workspace.can.create.allowed
								? 'Import a spreadsheet: the assistant proposes processes and drafts them'
								: `Import a spreadsheet: ${workspace.can.create.reason}`}
							aria-expanded={importing}
							disabled={!workspace.can.create.allowed}
							onclick={(e) => {
								importAt = e.currentTarget.getBoundingClientRect().left;
								importError = undefined;
								importing = !importing;
							}}><FileSpreadsheet class="size-4" />Import a spreadsheet</button
						>
					</div>
					{#if wizard && !assistantOpen}
						<button
							class="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px] font-medium hover:bg-muted"
							onclick={() => (assistantOpen = true)}><Sparkles class="size-3.5" />Assistant</button
						>
					{/if}
					{#if !isMap && active && loaded}
						<Segmented
							label="View"
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
				{#if creating}
					<form
						class="fixed top-[108px] z-40 flex w-72 flex-col gap-1.5 rounded-xl border bg-popover p-2.5 shadow-lg"
						style:left="{Math.max(8, createAt - 8)}px"
						onsubmit={create}
					>
						<!-- svelte-ignore a11y_autofocus -->
						<input
							class="h-8 rounded-md bg-muted/70 px-2 text-[12.5px] outline-none focus:ring-2 focus:ring-brand-ring"
							placeholder="Process name"
							aria-label="Process name"
							bind:value={newTitle}
							autofocus
							required
						/>
						<select
							class="h-8 cursor-pointer rounded-md bg-muted/70 px-1.5 text-[12px] outline-none"
							aria-label="Change policy"
							bind:value={newPolicy}
						>
							<option value="governed">Governed: publish when ready</option>
							<option value="living">Living: every edit goes live</option>
						</select>
						<div class="flex justify-end gap-1.5">
							<button
								type="button"
								class="h-7 cursor-pointer rounded-md px-2 text-[12px] text-muted-foreground hover:bg-muted"
								onclick={() => (creating = false)}>Cancel</button
							>
							<button
								class="h-7 cursor-pointer rounded-md bg-brand px-2.5 text-[12px] font-medium text-white hover:opacity-90"
								>Create</button
							>
						</div>
					</form>
				{/if}

				{#if importing}
					<div
						class="fixed top-[108px] z-40 flex w-80 flex-col gap-2.5 rounded-xl border bg-popover p-3 text-[12.5px] shadow-lg"
						style:left="{Math.max(8, importAt - 8)}px"
					>
						<div class="flex items-start gap-2">
							<p class="flex-1 text-muted-foreground">
								The assistant reads the sheet, suggests processes and drafts them on the board.
								Nothing is created or changed until you accept it.
							</p>
							<button
								class="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
								aria-label="Close"
								onclick={() => (importing = false)}><X class="size-3.5" /></button
							>
						</div>
						<form
							class="flex flex-col gap-2"
							onsubmit={(e) => {
								e.preventDefault();
								void startImport(new FormData(e.currentTarget));
							}}
						>
							<input
								type="file"
								name="file"
								accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
								required
								aria-label="Spreadsheet"
								class="text-[12px] file:mr-2 file:cursor-pointer file:rounded-md file:border file:bg-background file:px-2 file:py-1"
							/>
							<button
								class="h-8 cursor-pointer rounded-lg bg-brand px-3 font-medium text-white hover:opacity-90 disabled:opacity-45"
								disabled={uploading}>Import</button
							>
						</form>
						<div class="flex items-center gap-2 border-t pt-2.5">
							<button
								class="inline-flex h-8 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-foreground px-2 font-medium text-background hover:opacity-90 disabled:opacity-45"
								disabled={uploading}
								onclick={() => {
									const body = new FormData();
									body.set('sample', '1');
									void startImport(body);
								}}><FileSpreadsheet class="size-3.5" />Use the sample: newborn-tracker.xlsx</button
							>
							<a
								href={resolve('/wizard/sample')}
								download
								class="flex size-8 items-center justify-center rounded-lg border text-muted-foreground hover:bg-muted"
								title="Download the sample"
								aria-label="Download the sample"><Download class="size-3.5" /></a
							>
						</div>
						{#if uploading}<p class="flex items-center gap-1.5 text-muted-foreground">
								<LoaderCircle class="size-3.5 animate-spin" />Reading the spreadsheet…
							</p>{/if}
						{#if importError}<p class="text-destructive" role="alert">{importError}</p>{/if}
						{#if data.imports.length}
							<div class="flex flex-col gap-1 border-t pt-2.5">
								<p class="text-[11px] font-medium text-muted-foreground">Continue an import</p>
								{#each data.imports.slice(0, 4) as imp (imp.id)}
									<button
										class="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-muted"
										onclick={() => {
											importing = false;
											assistantOpen = true;
											nav({ wizard: imp.id });
										}}
										><FileSpreadsheet class="size-3.5 shrink-0 text-muted-foreground" /><span
											class="min-w-0 flex-1 truncate">{imp.fileName}</span
										><span class="shrink-0 text-[11px] text-muted-foreground"
											>{imp.processes
												? `${imp.processes} ${imp.processes === 1 ? 'process' : 'processes'}`
												: 'choosing processes'}</span
										></button
									>
								{/each}
							</div>
						{/if}
					</div>
				{/if}

				<main class="relative min-h-0 flex-1">
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
								Use + beside the processes to start one.{/if}
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
						<button
							class="cursor-pointer hover:text-foreground"
							onclick={() => nav({ sel: 'shared' })}>{shared.length} shared fact types</button
						>
					{:else if active}
						<span
							>{active.work.length} steps and decisions · {active.stages.length} stages · {active
								.facts.length} fact types · {active.roles.length} roles</span
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
