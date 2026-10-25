<script lang="ts">
	// Processes: the definitions in this instance, with status, version, change policy and live
	// cases. Each opens on its own page, where it is edited or a case is started.
	import { ChevronRight, FolderTree, Plus } from '@lucide/svelte';
	import Frame from '$lib/runner/Frame.svelte';
	import DefinitionMeta from '$lib/runner/DefinitionMeta.svelte';
	import { day } from '$lib/runner/format';
	import { links } from '$lib/runner/links';
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
	const firstWritable = $derived(writable.find((g) => g.definitions.length) ?? writable[0]);
</script>

<svelte:head><title>Processes · {data.instance.name}</title></svelte:head>

<Frame user={data.user} instance={data.instance} instances={data.instances} mode="processes">
	<div class="mx-auto max-w-3xl px-4 py-8">
		<header class="mb-6 flex flex-wrap items-start gap-4 px-1">
			<div class="min-w-0 flex-1">
				<h1 class="text-[22px] font-semibold tracking-tight">Processes</h1>
				<p class="mt-1 text-[14px] text-muted-foreground">
					The process definitions in {data.instance.name}. Cases run their published versions.
				</p>
				<p class="mt-2 text-[12px] text-muted-foreground">{access}</p>
			</div>
			{#if firstWritable}
				<a
					href={links.editor(slug, firstWritable.namespace)}
					class="flex h-9 items-center gap-1.5 rounded-lg bg-foreground px-3.5 text-[13px] font-medium text-background hover:bg-foreground/90"
					><Plus class="size-4" />New process</a
				>
			{/if}
		</header>

		{#each data.groups.filter((g) => g.definitions.length) as group (group.namespace)}
			<section class="mt-8 first-of-type:mt-0">
				<h2 class="mb-2 flex items-center gap-2 px-1 text-[13px] font-semibold">
					<FolderTree class="size-4 text-muted-foreground" />
					{group.label}
					<span class="font-mono text-[11px] font-normal text-muted-foreground/70"
						>{group.namespace}</span
					>
				</h2>
				<ul class="divide-y overflow-hidden rounded-xl border bg-card">
					{#each group.definitions as p (p.id)}
						<li>
							<a
								href={links.process(slug, p.slug)}
								class="group flex items-center gap-3 px-4 py-3.5 hover:bg-muted/50"
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
								<ChevronRight class="size-4 shrink-0 text-muted-foreground/50" />
							</a>
						</li>
					{/each}
				</ul>
			</section>
		{:else}
			<p
				class="rounded-xl border border-dashed bg-card px-5 py-8 text-center text-[13px] text-muted-foreground"
			>
				No processes here yet.
			</p>
		{/each}
	</div>
</Frame>
