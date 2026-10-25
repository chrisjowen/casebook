<script lang="ts">
	// Definition outline: workspace, then processes > stages > steps and decisions, plus the
	// workspace's shared fact types and roles.
	import { ChevronDown, ChevronRight, Workflow, Network, Users, Signpost } from '@lucide/svelte';
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
		onshared
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
	} = $props();

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
					>{w.label}</Select.Item
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
		<div
			class="mt-1.5 px-2 py-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase"
		>
			Processes
		</div>
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
