<script lang="ts">
	// The case record: every captured value, file and document, recorded once and shared by every
	// process on the case (ADR 0001), each linked to the task, person and time it came from.
	import { page } from '$app/state';
	import { ExternalLink, FileText } from '@lucide/svelte';
	import type { RecordEntry } from '@casebook/store';
	import Frame from '$lib/runner/Frame.svelte';
	import FilterChips from '$lib/runner/FilterChips.svelte';
	import { size, when } from '$lib/runner/format';
	import { links } from '$lib/runner/links';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const c = $derived(data.case);
	const slug = $derived(data.instance.slug);
	const filter = $derived(page.url.searchParams.get('process') ?? '');
	const open = $derived(c.mine.filter((t) => t.status === 'ready' || t.status === 'held').length);
	const options = $derived([
		...new Map(
			c.processes.map((p) => [
				p.definitionSlug,
				{ value: p.definitionSlug, label: p.name.split(' · ')[0]! }
			])
		).values()
	]);
	const keep = (r: RecordEntry) => {
		if (!filter) return true;
		const runs = c.processes.filter((p) => p.definitionSlug === filter);
		return (
			runs.some((p) => p.id === r.from?.attachmentId) ||
			r.sharedBy.some((name) => runs.some((p) => p.name === name))
		);
	};
	const files = $derived(c.record.filter((r) => r.file && keep(r)));
	const values = $derived(c.record.filter((r) => !r.file && keep(r)));
</script>

<svelte:head><title>Case record · {c.title}</title></svelte:head>

{#snippet source(r: RecordEntry)}
	<span class="text-[12px] text-muted-foreground">
		{r.by.name}{#if r.onBehalfOf}
			for {r.onBehalfOf.name}{/if} · {when(r.at)}
		{#if r.from}
			<br />in
			<a
				href={links.task(slug, c.id, r.from.attachmentId, r.from.item)}
				class="text-foreground/80 underline-offset-2 hover:underline">{r.from.title}</a
			>
			<span class="text-muted-foreground/80">· {r.from.process}</span>
		{/if}
	</span>
{/snippet}

{#snippet shared(r: RecordEntry)}
	{#if r.sharedBy.length > 1}
		<span class="mt-1 block text-[12px] text-muted-foreground"
			>Shared by {r.sharedBy.join(' and ')}</span
		>
	{/if}
{/snippet}

<Frame
	user={data.user}
	instance={data.instance}
	instances={data.instances}
	crumbs={[{ label: c.title, href: links.case(slug, c.id) }, { label: 'Case record' }]}
	tabs={[
		{ label: 'Overview', href: links.case(slug, c.id), active: false, count: open },
		{ label: 'Case record', href: links.record(slug, c.id), active: true }
	]}
>
	<div class="mx-auto max-w-3xl px-4 py-8">
		<header class="mb-6 px-1">
			<h1 class="text-[22px] font-semibold tracking-tight">Case record</h1>
			<p class="mt-1 text-[14px] text-muted-foreground">
				Everything recorded on {c.title}, once, with who recorded it and where. Every process on the
				case reads from here.
			</p>
		</header>

		<div class="mb-6 px-1"><FilterChips {options} /></div>

		{#if files.length}
			<section class="mb-8">
				<h2 class="mb-2 px-1 text-[13px] font-semibold">Documents and files</h2>
				<ul class="divide-y rounded-xl border bg-card">
					{#each files as r (r.file!.id + (r.fact ?? ''))}
						<li
							class="grid gap-x-4 gap-y-2 px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,15rem)]"
						>
							<div class="min-w-0">
								<p class="text-[14px] font-medium">{r.evidence ?? r.title}</p>
								<a
									href={links.file(r.file!.id)}
									target="_blank"
									rel="noopener"
									class="mt-1.5 inline-flex max-w-full items-center gap-2 rounded-lg border bg-background px-2.5 py-1.5 text-[13px] hover:border-foreground/20"
								>
									<FileText class="size-4 shrink-0 text-muted-foreground" />
									<span class="truncate">{r.file!.name}</span>
									<span class="shrink-0 text-[12px] text-muted-foreground"
										>{size(r.file!.size)}</span
									>
									<ExternalLink class="size-3.5 shrink-0 text-muted-foreground" />
								</a>
								{@render shared(r)}
							</div>
							{@render source(r)}
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		<section>
			<h2 class="mb-2 px-1 text-[13px] font-semibold">Values</h2>
			{#if values.length}
				<ul class="divide-y rounded-xl border bg-card">
					{#each values as r (r.fact ?? r.title)}
						<li class="grid gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,15rem)]">
							<div class="min-w-0">
								<p class="text-[13px] text-muted-foreground">{r.title}</p>
								<p class="text-[14px] font-medium break-words">{r.display}</p>
								{@render shared(r)}
							</div>
							{@render source(r)}
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
