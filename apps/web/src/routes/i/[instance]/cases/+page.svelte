<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import Frame from '$lib/runner/Frame.svelte';
	import ActionsMenu from '$lib/shell/ActionsMenu.svelte';
	import { caseVerbs } from '$lib/shell/actions';
	import StageStrip from '$lib/runner/StageStrip.svelte';
	import { day } from '$lib/runner/format';
	import { links } from '$lib/runner/links';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const slug = $derived(data.instance.slug);
</script>

<svelte:head><title>Cases · {data.instance.name}</title></svelte:head>

<Frame user={data.user} instance={data.instance} instances={data.instances}>
	<div class="max-w-6xl px-4 py-8 lg:px-6">
		<header class="mb-6 flex flex-wrap items-start gap-4 px-1">
			<div class="min-w-0 flex-1">
				<h1 class="text-[22px] font-semibold tracking-tight">Cases</h1>
				<p class="mt-1 text-[14px] text-muted-foreground">
					Each case gathers the processes run for one person or thing. Open one to see them all.
				</p>
			</div>
			{#if data.shell.canStart.allowed}
				<a
					href={links.newCase(slug)}
					class="flex h-9 items-center gap-1.5 rounded-lg bg-foreground px-3.5 text-[13px] font-medium text-background hover:bg-foreground/90"
					><Plus class="size-4" />New case</a
				>
			{:else}
				<span
					class="flex h-9 cursor-not-allowed items-center gap-1.5 rounded-lg border border-dashed px-3.5 text-[13px] text-muted-foreground"
					title={data.shell.canStart.reason}><Plus class="size-4" />New case</span
				>
			{/if}
		</header>

		{#if data.cases.length === 0}
			<p
				class="rounded-xl border border-dashed bg-card px-5 py-8 text-center text-[13px] text-muted-foreground"
			>
				No cases you can open yet.
			</p>
		{/if}
		<ul class="grid gap-3">
			{#each data.cases as c (c.id)}
				<li class="relative">
					<a
						href={links.case(slug, c.id)}
						class="group block rounded-xl border bg-card px-5 py-4 transition-colors hover:border-foreground/20"
					>
						<div class="flex items-start gap-3">
							<div class="min-w-0 flex-1">
								<div class="flex flex-wrap items-baseline gap-x-2">
									<span class="text-[15px] font-semibold">{c.title}</span>
									{#if c.forYou}
										<span
											class="rounded-full bg-brand-soft px-2 py-0.5 text-[12px] font-medium text-brand"
											>{c.forYou} for you</span
										>
									{/if}
								</div>
								<p class="mt-0.5 text-[13px] text-muted-foreground">
									{[c.subject, `opened ${day(c.openedAt)}`].filter(Boolean).join(' · ')}
								</p>
							</div>
							<span class="size-8 shrink-0"></span>
						</div>
						<div class="mt-3 grid gap-2">
							{#each c.processes as p (p.id)}
								<div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
									<span class="text-[13px]">{p.name}</span>
									<StageStrip stages={p.stages} size="mini" />
								</div>
							{/each}
						</div>
					</a>
					<div class="absolute top-3 right-3">
						<ActionsMenu verbs={caseVerbs(slug, c)} label={c.title} omit={['open']} size="sm" />
					</div>
				</li>
			{/each}
		</ul>
	</div>
</Frame>
