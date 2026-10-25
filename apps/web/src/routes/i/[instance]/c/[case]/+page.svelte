<script lang="ts">
	// A case's own workspace: the user's tasks on it, one stage strip per attached process with a
	// plain line about what others are doing, and the latest from the case record.
	import { page } from '$app/state';
	import { FileText, Plus, Workflow } from '@lucide/svelte';
	import Frame from '$lib/runner/Frame.svelte';
	import FilterChips from '$lib/runner/FilterChips.svelte';
	import Notice from '$lib/runner/Notice.svelte';
	import Section from '$lib/runner/Section.svelte';
	import StageStrip from '$lib/runner/StageStrip.svelte';
	import TaskRow from '$lib/runner/TaskRow.svelte';
	import { day } from '$lib/runner/format';
	import { links } from '$lib/runner/links';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const c = $derived(data.case);
	const slug = $derived(data.instance.slug);
	const filter = $derived(page.url.searchParams.get('process') ?? '');
	const started = $derived(page.url.searchParams.get('started'));
	const keep = (definitionSlug: string) => !filter || definitionSlug === filter;
	const mine = $derived(c.mine.filter((t) => keep(t.definitionSlug)));
	const open = $derived(c.mine.filter((t) => t.status === 'ready' || t.status === 'held').length);
	const recent = $derived(c.record.filter((r) => !r.evidence).slice(0, 4));
	const options = $derived([
		...new Map(
			c.processes.map((p) => [
				p.definitionSlug,
				{ value: p.definitionSlug, label: p.name.split(' · ')[0]! }
			])
		).values()
	]);
</script>

<svelte:head><title>{c.title} · {data.instance.name}</title></svelte:head>

<Frame
	user={data.user}
	instance={data.instance}
	instances={data.instances}
	crumbs={[{ label: c.title }]}
	tabs={[
		{ label: 'Overview', href: links.case(slug, c.id), active: true, count: open },
		{ label: 'Case record', href: links.record(slug, c.id), active: false }
	]}
>
	<div class="mx-auto max-w-3xl px-4 py-8">
		<header class="mb-6 px-1">
			<h1 class="text-[22px] font-semibold tracking-tight">{c.title}</h1>
			<p class="mt-1 text-[14px] text-muted-foreground">
				{[c.subject, `opened ${day(c.openedAt)}${c.openedBy ? ` by ${c.openedBy.name}` : ''}`]
					.filter(Boolean)
					.join(' · ')}
			</p>
		</header>

		{#if started}
			<Notice>
				<span class="font-medium">Started {started}.</span>
				<span class="text-muted-foreground"
					>It shows on My work for everyone it needs as it reaches them.</span
				>
			</Notice>
		{/if}

		<div class="mb-6 px-1"><FilterChips {options} /></div>

		{#if mine.length}
			<Section title="Your tasks in this case" count={mine.length}>
				{#each mine as task (task.attachmentId + task.item)}
					<TaskRow
						{task}
						me={data.user.id}
						showCase={false}
						showStatus
						href={links.task(slug, c.id, task.attachmentId, task.item)}
					/>
				{/each}
			</Section>
		{:else}
			<p
				class="rounded-xl border border-dashed bg-card px-5 py-4 text-[13px] text-muted-foreground"
			>
				Nothing in this case needs you right now.
			</p>
		{/if}

		<section class="mt-8">
			<div class="mb-2 flex items-baseline px-1">
				<h2 class="text-[13px] font-semibold">Processes on this case</h2>
				{#if c.can.addProcess}
					<a
						href={links.newCase(slug, { case: c.id })}
						class="ml-auto flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
						><Plus class="size-3.5" />Add a process</a
					>
				{/if}
			</div>
			<div class="grid gap-3">
				{#each c.processes.filter((p) => keep(p.definitionSlug)) as p (p.id)}
					<article class="rounded-xl border bg-card px-5 py-4">
						<div class="mb-3 flex items-start gap-3">
							<div class="min-w-0 flex-1">
								<h3 class="text-[14px] font-semibold">{p.name}</h3>
								<p class="text-[12px] text-muted-foreground">
									{p.complete ? 'All stages done' : `Stage ${p.line.number} of ${p.line.count}`}
									· {p.binding === 'pinned'
										? `pinned to v${p.version}`
										: 'follows the latest version'}
								</p>
							</div>
							<a
								href={links.wholeProcess(slug, c.id, p.id)}
								class="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground"
								><Workflow class="size-3.5" />View whole process</a
							>
						</div>
						<StageStrip stages={p.stages} />
						<p class="mt-3 text-[13px] text-muted-foreground">{p.others}</p>
					</article>
				{/each}
			</div>
		</section>

		<section class="mt-8">
			<div class="mb-2 flex items-baseline px-1">
				<h2 class="text-[13px] font-semibold">Latest in the case record</h2>
				<a
					href={links.record(slug, c.id)}
					class="ml-auto text-[12px] text-muted-foreground hover:text-foreground">See all</a
				>
			</div>
			{#if recent.length}
				<ul class="divide-y rounded-xl border bg-card">
					{#each recent as r (r.fact ?? r.title)}
						<li class="flex items-start gap-3 px-4 py-3 text-[13px]">
							<FileText class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
							<div class="min-w-0 flex-1">
								<span class="font-medium">{r.title}</span>
								{#if r.file}
									<a
										href={links.file(r.file.id)}
										target="_blank"
										rel="noopener"
										class="text-muted-foreground underline-offset-2 hover:underline"
										>· {r.display}</a
									>
								{:else}
									<span class="text-muted-foreground">· {r.display}</span>
								{/if}
								<p class="text-[12px] text-muted-foreground">
									{[r.by.name, day(r.at), r.from?.title].filter(Boolean).join(' · ')}
								</p>
							</div>
						</li>
					{/each}
				</ul>
			{:else}
				<p
					class="rounded-xl border border-dashed bg-card px-5 py-4 text-[13px] text-muted-foreground"
				>
					Nothing is recorded yet.
				</p>
			{/if}
		</section>
	</div>
</Frame>
