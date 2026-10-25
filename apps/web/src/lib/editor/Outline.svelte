<script lang="ts">
	// Definition outline: workspace, then processes > stages > steps and decisions, plus the
	// workspace's shared fact types and roles, and "New process" for those who may create one.
	import {
		ChevronDown,
		ChevronRight,
		Workflow,
		Network,
		Users,
		Signpost,
		Plus
	} from '@lucide/svelte';
	import * as Select from '$lib/components/ui/select';
	import { labelOf, type ProcessIndex, type SharedFactType } from '$lib/graph/derive';
	import type { Workspace } from '$lib/definitions/types';

	let {
		workspaces,
		workspace,
		indexes,
		shared,
		activeSlug,
		selectedId,
		onworkspace,
		onprocess,
		onitem,
		onmap,
		onshared,
		oncreate
	}: {
		workspaces: Workspace[];
		workspace: Workspace;
		indexes: ProcessIndex[];
		shared: SharedFactType[];
		/** Slug of the open process, or undefined when the map is open. */
		activeSlug?: string;
		selectedId?: string;
		onworkspace: (namespace: string) => void;
		onprocess: (slug: string) => void;
		onitem: (slug: string, id: string) => void;
		onmap: () => void;
		onshared: () => void;
		/** Creates a process in the workspace; resolves once it is open. */
		oncreate?: (title: string, changePolicy: 'governed' | 'living') => Promise<void>;
	} = $props();

	let creating = $state(false);
	let title = $state('');
	let policy = $state<'governed' | 'living'>('governed');
	async function create(e: SubmitEvent) {
		e.preventDefault();
		await oncreate?.(title, policy);
		creating = false;
		title = '';
	}

	let expanded = $state<Record<string, boolean>>({});
	let sharedOpen = $state(true);
	let rolesOpen = $state(false);
	const isOpen = (slug: string) => expanded[slug] ?? slug === activeSlug;
	const roles = $derived([
		...new Map(
			indexes.flatMap((ix) => ix.roles.map((r) => [r.core.id, labelOf(ix, r.core.id)] as const))
		).values()
	]);
</script>

<aside
	class="flex w-64 shrink-0 flex-col gap-2 overflow-hidden border-r bg-background p-2.5"
	aria-label="Outline"
>
	<Select.Root type="single" value={workspace.namespace} onValueChange={onworkspace}>
		<Select.Trigger class="h-10 w-full rounded-xl text-[13px] font-medium" aria-label="Workspace"
			>{workspace.label}</Select.Trigger
		>
		<Select.Content>
			{#each workspaces as w (w.namespace)}<Select.Item value={w.namespace} label={w.label}
					>{w.label}<span class="ml-auto pl-3 text-[11px] text-muted-foreground">{w.namespace}</span
					></Select.Item
				>{/each}
		</Select.Content>
	</Select.Root>

	<div class="no-scrollbar min-h-0 flex-1 overflow-y-auto rounded-xl bg-muted/40 p-1.5 text-[13px]">
		<button
			class={[
				'flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left',
				!activeSlug ? 'bg-background font-medium shadow-xs' : 'hover:bg-background/70'
			]}
			onclick={onmap}><Network class="size-4 text-muted-foreground" />Process map</button
		>
		<div class="mt-1.5 flex items-center pl-2">
			<span
				class="flex-1 py-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase"
				>Processes</span
			>
			<button
				class="flex size-6 items-center justify-center rounded-md text-muted-foreground enabled:cursor-pointer enabled:hover:bg-background enabled:hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
				title={workspace.can.create.allowed
					? 'New process'
					: `New process: ${workspace.can.create.reason}`}
				aria-label="New process"
				disabled={!workspace.can.create.allowed || !oncreate}
				onclick={() => (creating = !creating)}><Plus class="size-3.5" /></button
			>
		</div>
		{#if creating}
			<form
				class="mb-1.5 flex flex-col gap-1.5 rounded-lg bg-background p-2 shadow-xs"
				onsubmit={create}
			>
				<!-- svelte-ignore a11y_autofocus -->
				<input
					class="h-8 rounded-md bg-muted/70 px-2 text-[12.5px] outline-none focus:ring-2 focus:ring-brand-ring"
					placeholder="Process name"
					aria-label="Process name"
					bind:value={title}
					autofocus
					required
				/>
				<select
					class="h-8 cursor-pointer rounded-md bg-muted/70 px-1.5 text-[12px] outline-none"
					aria-label="Change policy"
					bind:value={policy}
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
		{#each indexes as ix (ix.document.slug)}
			{@const slug = ix.document.slug}
			<div
				class={[
					'flex items-center rounded-lg',
					activeSlug === slug && !selectedId ? 'bg-background shadow-xs' : 'hover:bg-background/70'
				]}
			>
				<button
					class="flex size-7 shrink-0 cursor-pointer items-center justify-center text-muted-foreground"
					aria-label={isOpen(slug) ? 'Collapse' : 'Expand'}
					onclick={() => (expanded[slug] = !isOpen(slug))}
				>
					{#if isOpen(slug)}<ChevronDown class="size-3.5" />{:else}<ChevronRight
							class="size-3.5"
						/>{/if}
				</button>
				<button
					class={[
						'flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-1.5 pr-2 text-left',
						activeSlug === slug && 'font-medium'
					]}
					onclick={() => onprocess(slug)}
				>
					<Workflow class="size-4 shrink-0 text-brand" /><span class="truncate"
						>{labelOf(ix, ix.process?.core.id)}</span
					>
				</button>
			</div>
			{#if isOpen(slug)}
				<div class="ml-[13px] border-l pl-2">
					{#each ix.stages as stage (stage.core.id)}
						<div class="truncate px-2 pt-1.5 pb-0.5 text-[11.5px] text-muted-foreground">
							{labelOf(ix, stage.core.id)}
						</div>
						{#each ix.work.filter((w) => w.core.stage === stage.core.id) as item (item.core.id)}
							<button
								class={[
									'flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-left text-[12.5px]',
									selectedId === item.core.id
										? 'bg-background font-medium shadow-xs'
										: 'text-foreground/80 hover:bg-background/70'
								]}
								onclick={() => onitem(slug, item.core.id)}
							>
								{#if item.core.kind === 'decision'}<Signpost
										class="size-3 shrink-0 text-muted-foreground"
									/>{:else}<span
										class={[
											'size-1.5 shrink-0 rounded-full',
											selectedId === item.core.id ? 'bg-brand' : 'bg-foreground/25'
										]}
									></span>{/if}
								<span class="truncate">{labelOf(ix, item.core.id)}</span>
							</button>
						{/each}
					{/each}
				</div>
			{/if}
		{:else}
			<p class="px-2 py-1 text-[12px] text-muted-foreground">No processes here yet.</p>
		{/each}
	</div>

	<div class="rounded-xl border">
		<button
			class="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-[11px] font-semibold tracking-wide uppercase"
			onclick={() => (sharedOpen = !sharedOpen)}
		>
			{#if sharedOpen}<ChevronDown class="size-3.5" />{:else}<ChevronRight
					class="size-3.5"
				/>{/if}Shared fact types<span class="ml-auto font-normal text-muted-foreground"
				>{shared.length}</span
			>
		</button>
		{#if sharedOpen}
			<div class="px-1.5 pb-1.5">
				{#each shared as fact (fact.id)}
					<button
						class="w-full cursor-pointer truncate rounded-lg px-2 py-1 text-left text-[12.5px] hover:bg-muted"
						onclick={onshared}>{fact.title}</button
					>
				{:else}
					<p class="px-2 pb-1 text-[12px] text-muted-foreground">
						None yet. Fact types used by several processes appear here.
					</p>
				{/each}
			</div>
		{/if}
	</div>
	<div class="rounded-xl border">
		<button
			class="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-[11px] font-semibold tracking-wide uppercase"
			onclick={() => (rolesOpen = !rolesOpen)}
		>
			{#if rolesOpen}<ChevronDown class="size-3.5" />{:else}<ChevronRight
					class="size-3.5"
				/>{/if}Roles<span class="ml-auto font-normal text-muted-foreground">{roles.length}</span>
		</button>
		{#if rolesOpen}
			<div class="px-3 pb-2">
				{#each roles as role (role)}<div class="flex items-center gap-2 py-0.5 text-[12.5px]">
						<Users class="size-3.5 text-muted-foreground" />{role}
					</div>{/each}
			</div>
		{/if}
	</div>
</aside>
