<script lang="ts">
	// A process definition's page, where running and designing meet: its status and change policy,
	// Edit (into the board editor) and Start a case, the cases running it, and a read-only outline.
	import { Lock, Play, SquarePen } from '@lucide/svelte';
	import { runnableProcess } from '@casebook/model';
	import Frame from '$lib/runner/Frame.svelte';
	import DefinitionMeta from '$lib/runner/DefinitionMeta.svelte';
	import Notice from '$lib/runner/Notice.svelte';
	import ProcessOutline from '$lib/runner/ProcessOutline.svelte';
	import StageStrip from '$lib/runner/StageStrip.svelte';
	import { day } from '$lib/runner/format';
	import { links } from '$lib/runner/links';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const slug = $derived(data.instance.slug);
	const p = $derived(data.view.process);
	const summary = $derived(runnableProcess(p.document).summary);
	const result = $derived((form ?? {}) as { moved?: string; version?: number; reason?: string });
</script>

<svelte:head><title>{p.title} · Processes</title></svelte:head>

<Frame
	user={data.user}
	instance={data.instance}
	instances={data.instances}
	mode="processes"
	crumbs={[{ label: p.title }]}
>
	<div class="mx-auto max-w-3xl px-4 py-8">
		{#if result.moved}
			<Notice>Moved {result.moved} to version {result.version}.</Notice>
		{:else if result.reason}
			<Notice tone="problem">{result.reason}</Notice>
		{/if}

		<header class="px-1">
			<p class="font-mono text-[12px] text-muted-foreground">{p.namespace}</p>
			<h1 class="mt-1 text-[22px] font-semibold tracking-tight">{p.title}</h1>
			{#if summary}<p class="mt-1 text-[14px] text-muted-foreground">{summary}</p>{/if}
			<div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
				<DefinitionMeta process={p} />
				<span class="text-[12px] text-muted-foreground"
					>Last changed by {p.updatedBy}, {day(p.updatedAt)}</span
				>
			</div>
		</header>

		<div class="mt-5 flex flex-wrap items-center gap-2 px-1">
			{#if p.can.edit.allowed}
				<a
					href={links.editor(slug, p.namespace, p.slug)}
					class="flex h-9 items-center gap-1.5 rounded-lg bg-foreground px-3.5 text-[13px] font-medium text-background hover:bg-foreground/90"
					><SquarePen class="size-4" />Edit</a
				>
			{/if}
			{#if p.can.start.allowed}
				<a
					href={links.newCase(slug, { process: p.slug })}
					class="flex h-9 items-center gap-1.5 rounded-lg border bg-background px-3.5 text-[13px] font-medium hover:bg-muted"
					><Play class="size-4" />Start a case</a
				>
			{:else}
				<span
					class="flex h-9 cursor-not-allowed items-center gap-1.5 rounded-lg border border-dashed px-3.5 text-[13px] text-muted-foreground"
					title={p.can.start.reason}><Play class="size-4" />Start a case</span
				>
				<span class="text-[12px] text-muted-foreground">
					{p.status === 'draft'
						? 'Publish it first: cases only run published versions.'
						: 'Starting a case needs write access or a role in this process.'}
				</span>
			{/if}
			{#if !p.can.edit.allowed}
				<a
					href={links.editor(slug, p.namespace, p.slug)}
					class="flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground"
					><Lock class="size-3.5" />Read-only for you: view it on the board</a
				>
			{/if}
		</div>
		{#if p.draftPending}
			<p class="mt-3 px-1 text-[12px] text-amber-800">
				Draft changes pending: running cases keep their version until it is published{p.policy ===
				'governed'
					? ' and they are moved'
					: ''}. The editor shows what changed.
			</p>
		{/if}

		<section class="mt-8">
			<h2 class="mb-2 px-1 text-[13px] font-semibold">
				Cases running it <span class="font-normal text-muted-foreground"
					>{data.view.cases.length + data.view.hiddenCases}</span
				>
			</h2>
			{#if data.view.cases.length}
				<ul class="divide-y rounded-xl border bg-card">
					{#each data.view.cases as run (run.attachment.id)}
						{@const behind =
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
					class="rounded-xl border border-dashed bg-card px-5 py-4 text-[13px] text-muted-foreground"
				>
					{p.status === 'published'
						? 'No cases yet. Start one to run this process.'
						: 'Nothing runs a draft.'}
				</p>
			{/if}
		</section>

		<section class="mt-8">
			<h2 class="-mb-3 px-1 text-[13px] font-semibold">
				Stages and steps <span class="font-normal text-muted-foreground"
					>· {data.namespaceLabel} · read-only here</span
				>
			</h2>
			<ProcessOutline document={p.document} authoring={p.can.edit.allowed} />
		</section>
	</div>
</Frame>
