<script lang="ts">
	// A process's home, Cases tab: every case running it that the user can open, with its stage,
	// the version it runs, and moving a pinned case to the latest version; Start a case on top.
	import { Play } from '@lucide/svelte';
	import Frame from '$lib/runner/Frame.svelte';
	import Notice from '$lib/runner/Notice.svelte';
	import StageStrip from '$lib/runner/StageStrip.svelte';
	import { links } from '$lib/runner/links';
	import ActionsMenu from '$lib/shell/ActionsMenu.svelte';
	import ProcessActions from '$lib/shell/ProcessActions.svelte';
	import { caseVerbs } from '$lib/shell/actions';
	import { processTabs } from '$lib/shell/process';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const slug = $derived(data.instance.slug);
	const p = $derived(data.view.process);
	const total = $derived(data.view.cases.length + data.view.hiddenCases);
	const result = $derived((form ?? {}) as { moved?: string; version?: number; reason?: string });
</script>

<svelte:head><title>Cases · {p.title}</title></svelte:head>

<Frame
	user={data.user}
	instance={data.instance}
	instances={data.instances}
	crumbs={[{ label: p.title, href: links.process(slug, p.slug) }, { label: 'Cases' }]}
	tabs={processTabs(slug, { ...p, canEdit: p.can.edit.allowed }, 'cases', total)}
>
	{#snippet actions()}
		<ProcessActions
			instance={slug}
			process={{ ...p, canEdit: p.can.edit, canStart: p.can.start }}
			title={p.title}
			omit={['cases']}
		/>
	{/snippet}

	<div class="max-w-6xl px-4 py-8 lg:px-6">
		{#if result.moved}
			<Notice>Moved {result.moved} to version {result.version}.</Notice>
		{:else if result.reason}
			<Notice tone="problem">{result.reason}</Notice>
		{/if}

		<header class="mb-6 flex flex-wrap items-start gap-4 px-1">
			<div class="min-w-0 flex-1">
				<h1 class="text-[22px] font-semibold tracking-tight">Cases running {p.title}</h1>
				<p class="mt-1 text-[14px] text-muted-foreground">
					{total
						? `${total} ${total === 1 ? 'case runs' : 'cases run'} this process${p.version ? `; the latest version is ${p.version}` : ''}.`
						: 'No case runs this process yet.'}
				</p>
			</div>
			{#if !p.can.start.allowed}
				<span
					class="flex h-9 cursor-not-allowed items-center gap-1.5 rounded-lg border border-dashed px-3.5 text-[13px] text-muted-foreground"
					title={p.can.start.reason}><Play class="size-4" />Start a case</span
				>
			{/if}
		</header>
		{#if !p.can.start.allowed}
			<p class="-mt-3 mb-6 px-1 text-[12px] text-muted-foreground">
				{p.status === 'draft'
					? 'Publish it first: cases only run published versions.'
					: 'Starting a case needs write access or a role in this process.'}
			</p>
		{/if}

		{#if data.view.cases.length}
			<ul class="divide-y rounded-xl border bg-card">
				{#each data.view.cases as run (run.attachment.id)}
					{@const behind =
						!run.attachment.complete &&
						run.attachment.binding === 'pinned' &&
						run.attachment.version < run.attachment.latestVersion}
					<li class="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
						<a
							href={links.case(slug, run.id)}
							class="min-w-0 flex-1 text-[14px] font-medium hover:underline"
							>{run.title}{#if run.attachment.name !== p.title}<span
									class="font-normal text-muted-foreground"
								>
									· {run.attachment.name.split(' · ').slice(1).join(' · ')}</span
								>{/if}</a
						>
						<StageStrip stages={run.attachment.stages} size="mini" />
						<span class="text-[12px] text-muted-foreground"
							>{run.attachment.binding === 'pinned'
								? `Pinned to v${run.attachment.version}`
								: 'Follows latest'}</span
						>
						{#if behind && p.can.edit.allowed}
							<form method="POST" action="?/move">
								<input type="hidden" name="attachment" value={run.attachment.id} />
								<input type="hidden" name="title" value={run.title} />
								<button
									class="cursor-pointer rounded-lg border px-2.5 py-1 text-[12px] font-medium hover:bg-muted"
									>Move to v{run.attachment.latestVersion}</button
								>
							</form>
						{/if}
						<ActionsMenu verbs={caseVerbs(slug, run)} label={run.title} omit={['add']} size="sm" />
					</li>
				{/each}
			</ul>
		{/if}
		{#if data.view.hiddenCases}
			<p class="mt-2 px-1 text-[12px] text-muted-foreground">
				{data.view.hiddenCases} more {data.view.hiddenCases === 1 ? 'case' : 'cases'} you can’t open.
			</p>
		{/if}
		{#if !data.view.cases.length && !data.view.hiddenCases}
			<p
				class="rounded-xl border border-dashed bg-card px-5 py-8 text-center text-[13px] text-muted-foreground"
			>
				{p.status === 'published'
					? 'No cases yet. Start one to run this process.'
					: 'Nothing runs a draft. Publish it on the board first.'}
			</p>
		{/if}
	</div>
</Frame>
