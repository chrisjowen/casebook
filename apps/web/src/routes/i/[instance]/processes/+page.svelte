<script lang="ts">
	// Processes: the definitions in this instance, with status, version, change policy and live
	// cases. Each opens on its own home, with Overview, Edit (the board) and Cases tabs; each row
	// has the same actions menu as the process's own page.
	import { FileSpreadsheet, FolderTree, Network, Plus } from '@lucide/svelte';
	import Frame from '$lib/runner/Frame.svelte';
	import DefinitionMeta from '$lib/runner/DefinitionMeta.svelte';
	import { day } from '$lib/runner/format';
	import { links } from '$lib/runner/links';
	import ActionsMenu from '$lib/shell/ActionsMenu.svelte';
	import { processVerbs } from '$lib/shell/actions';
	import { shellUi } from '$lib/shell/ui.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const slug = $derived(data.instance.slug);
	const writable = $derived(data.groups.filter((g) => g.canCreate.allowed));
	const access = $derived(
		writable.length === data.groups.length && writable.length > 0
			? 'You can create and edit every process here.'
			: writable.length
				? `You can edit processes in ${writable.map((g) => g.label).join(' and ')}, and browse the rest.`
				: 'You can browse processes and start cases. To edit them, ask an account owner for access.'
	);
</script>

<svelte:head><title>Processes · {data.instance.name}</title></svelte:head>

<Frame user={data.user} instance={data.instance} instances={data.instances}>
	<div class="max-w-6xl px-4 py-8 lg:px-6">
		<header class="mb-6 flex flex-wrap items-start gap-4 px-1">
			<div class="min-w-0 flex-1">
				<h1 class="text-[22px] font-semibold tracking-tight">Processes</h1>
				<p class="mt-1 text-[14px] text-muted-foreground">
					The process definitions in {data.instance.name}. Cases run their published versions.
				</p>
				<p class="mt-2 text-[12px] text-muted-foreground">{access}</p>
			</div>
			{#if writable.length}
				<div class="flex items-center gap-2">
					<button
						class="flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border bg-background px-3.5 text-[13px] font-medium hover:bg-muted"
						onclick={() => (shellUi.importing = true)}
						><FileSpreadsheet class="size-4" />Import a spreadsheet</button
					>
					<button
						class="flex h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-foreground px-3.5 text-[13px] font-medium text-background hover:bg-foreground/90"
						onclick={() => (shellUi.newProcess = true)}><Plus class="size-4" />New process</button
					>
				</div>
			{/if}
		</header>

		{#each data.groups.filter((g) => g.definitions.length) as group (group.namespace)}
			<section class="mt-8 first-of-type:mt-0">
				<h2 class="mb-2 flex items-center gap-2 px-1 text-[13px] font-semibold">
					<FolderTree class="size-4 text-muted-foreground" />
					<span title={group.namespace}>{group.label}</span>
					<a
						href={links.editor(slug, group.namespace, 'map')}
						class="ml-auto flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-normal text-muted-foreground hover:bg-muted hover:text-foreground"
						title="How the processes in {group.label} hand facts to each other"
						><Network class="size-3.5" />Process map</a
					>
				</h2>
				<ul class="divide-y rounded-xl border bg-card">
					{#each group.definitions as p (p.id)}
						<li class="relative">
							<a
								href={links.process(slug, p.slug)}
								class="flex items-center gap-3 py-3.5 pr-14 pl-4 hover:bg-muted/50"
							>
								<div class="min-w-0 flex-1">
									<p class="text-[14px] font-medium">{p.title}</p>
									<div class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
										<DefinitionMeta process={p} compact />
										<span class="text-[12px] text-muted-foreground">
											{p.liveCases
												? `${p.liveCases} live ${p.liveCases === 1 ? 'case' : 'cases'}`
												: p.status === 'draft'
													? 'No cases until published'
													: 'No live cases'}
										</span>
									</div>
									<p class="mt-1 text-[12px] text-muted-foreground/80">
										Last changed by {p.updatedBy}, {day(p.updatedAt)}
									</p>
								</div>
							</a>
							<div class="absolute top-1/2 right-3 -translate-y-1/2">
								<ActionsMenu
									verbs={processVerbs(slug, {
										...p,
										canEdit: p.can.edit,
										canStart: p.can.start
									})}
									label={p.title}
									size="sm"
								/>
							</div>
						</li>
					{/each}
				</ul>
			</section>
		{:else}
			<div
				class="grid place-items-center rounded-xl border border-dashed bg-card px-6 py-14 text-center"
			>
				<p class="text-[14px] font-medium">No processes here yet</p>
				<p class="mt-1 text-[13px] text-muted-foreground">
					{writable.length
						? 'Start one on the board, or let the assistant draft some from a spreadsheet.'
						: 'Nobody has defined a process in this casebook yet.'}
				</p>
			</div>
		{/each}
	</div>
</Frame>
