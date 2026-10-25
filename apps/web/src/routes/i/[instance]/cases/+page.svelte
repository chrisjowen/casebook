<script lang="ts">
	import { ChevronRight, Plus } from '@lucide/svelte';
	import Frame from '$lib/runner/Frame.svelte';
	import StageStrip from '$lib/runner/StageStrip.svelte';
	import { day } from '$lib/runner/format';
	import { links } from '$lib/runner/links';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const slug = $derived(data.instance.slug);
</script>

<svelte:head><title>Cases · {data.instance.name}</title></svelte:head>

<Frame
	user={data.user}
	instance={data.instance}
	instances={data.instances}
	tabs={[
		{ label: 'My work', href: links.myWork(slug), active: false, count: data.open },
		{ label: 'Cases', href: links.cases(slug), active: true }
	]}
>
	<div class="mx-auto max-w-3xl px-4 py-8">
		<header class="mb-6 flex flex-wrap items-start gap-4 px-1">
			<div class="min-w-0 flex-1">
				<h1 class="text-[22px] font-semibold tracking-tight">Cases</h1>
				<p class="mt-1 text-[14px] text-muted-foreground">
					Each case is its own workspace. Open one to see every process attached to it.
				</p>
			</div>
			<a
				href={links.newCase(slug)}
				class="flex h-9 items-center gap-1.5 rounded-lg bg-foreground px-3.5 text-[13px] font-medium text-background hover:bg-foreground/90"
				><Plus class="size-4" />New case</a
			>
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
				<li>
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
									{#if c.subject}{c.subject} ·
									{/if}opened {day(c.openedAt)}
								</p>
							</div>
							<ChevronRight class="mt-1 size-4 text-muted-foreground/50" />
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
				</li>
			{/each}
		</ul>
	</div>
</Frame>
