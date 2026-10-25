<script lang="ts">
	// A process's home, Overview tab: what it is, its status and change policy, the draft-pending
	// note, the cases running it at a glance and its stages and steps. Edit (the board) and Cases
	// are the other tabs of the same page.
	import { ArrowRight, SquarePen } from '@lucide/svelte';
	import { runnableProcess } from '@casebook/model';
	import Frame from '$lib/runner/Frame.svelte';
	import DefinitionMeta from '$lib/runner/DefinitionMeta.svelte';
	import ProcessOutline from '$lib/runner/ProcessOutline.svelte';
	import StageStrip from '$lib/runner/StageStrip.svelte';
	import { day } from '$lib/runner/format';
	import { links } from '$lib/runner/links';
	import ProcessActions from '$lib/shell/ProcessActions.svelte';
	import { processTabs } from '$lib/shell/process';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const slug = $derived(data.instance.slug);
	const p = $derived(data.view.process);
	const summary = $derived(runnableProcess(p.document).summary);
	const count = (kind: string) => p.document.nodes.filter((n) => n.core.kind === kind).length;
	const work = $derived(count('step') + count('decision') + count('approval'));
	const total = $derived(data.view.cases.length + data.view.hiddenCases);
	const target = $derived({ ...p, canEdit: p.can.edit, canStart: p.can.start });
	const board = $derived(links.editor(slug, p.namespace, p.slug));
</script>

<svelte:head><title>{p.title} · Processes</title></svelte:head>

<Frame
	user={data.user}
	instance={data.instance}
	instances={data.instances}
	crumbs={[{ label: p.title }]}
	tabs={processTabs(slug, { ...p, canEdit: p.can.edit.allowed }, 'overview', total)}
>
	{#snippet actions()}
		<ProcessActions instance={slug} process={target} title={p.title} omit={['open']} />
	{/snippet}

	<div class="max-w-6xl px-4 py-8 lg:px-6">
		<header class="px-1">
			<p class="text-[12px] text-muted-foreground" title={p.namespace}>{data.namespaceLabel}</p>
			<h1 class="mt-1 text-[22px] font-semibold tracking-tight">{p.title}</h1>
			{#if summary}<p class="mt-1 max-w-[70ch] text-[14px] text-muted-foreground">
					{summary}
				</p>{/if}
			<div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
				<DefinitionMeta process={p} />
				<span class="text-[12px] text-muted-foreground"
					>Last changed by {p.updatedBy}, {day(p.updatedAt)}</span
				>
				{#if p.draftPending}
					<a href={board} class="text-[12px] font-medium text-foreground/80 hover:underline"
						>{p.can.edit.allowed
							? 'Review the draft on the board'
							: 'See the draft on the board'}</a
					>
				{/if}
			</div>
			<p class="mt-3 text-[13px] text-muted-foreground">
				{[
					`${p.liveCases} live ${p.liveCases === 1 ? 'case' : 'cases'}`,
					`${count('stage')} ${count('stage') === 1 ? 'stage' : 'stages'}`,
					`${work} ${work === 1 ? 'step' : 'steps'}`,
					`${count('role')} ${count('role') === 1 ? 'role' : 'roles'}`
				].join(' · ')}
			</p>
		</header>

		{#if p.status === 'draft'}
			<div
				class="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-card px-4 py-3 text-[13px]"
			>
				<span class="min-w-0 flex-1">
					<span class="font-medium">Not published yet.</span>
					<span class="text-muted-foreground"
						>Nothing runs a draft: publish it on the board when it’s ready.</span
					>
				</span>
				<a
					href={board}
					class="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-medium hover:bg-muted"
					><SquarePen class="size-3.5" />{p.can.edit.allowed
						? 'Review on the board'
						: 'View on the board'}</a
				>
			</div>
		{/if}

		<section class="mt-8">
			<div class="mb-2 flex items-baseline gap-2 px-1">
				<h2 class="text-[13px] font-semibold">
					Cases running it <span class="font-normal text-muted-foreground">{total}</span>
				</h2>
				{#if total}
					<a
						href={links.processCases(slug, p.slug)}
						class="ml-auto flex items-center gap-1 text-[12.5px] text-muted-foreground hover:text-foreground"
						>All cases<ArrowRight class="size-3.5" /></a
					>
				{/if}
			</div>
			{#if data.view.cases.length}
				<ul class="divide-y rounded-xl border bg-card">
					{#each data.view.cases.slice(0, 3) as run (run.attachment.id)}
						<li>
							<a
								href={links.case(slug, run.id)}
								class="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 hover:bg-muted/50"
							>
								<span class="min-w-0 flex-1 text-[14px] font-medium">{run.title}</span>
								<StageStrip stages={run.attachment.stages} size="mini" />
							</a>
						</li>
					{/each}
				</ul>
			{:else}
				<p
					class="rounded-xl border border-dashed bg-card px-5 py-4 text-[13px] text-muted-foreground"
				>
					{p.status === 'published'
						? 'No cases yet. Start one to run this process.'
						: 'Nothing runs a draft.'}
				</p>
			{/if}
		</section>

		<section class="mt-8">
			<h2 class="-mb-3 px-1 text-[13px] font-semibold">Stages and steps</h2>
			<ProcessOutline document={p.document} authoring={p.can.edit.allowed} />
		</section>
	</div>
</Frame>
