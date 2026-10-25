<script lang="ts">
	// Requests for you: a guest's only home. Each request says what it is, who asked and for whom,
	// and nothing else about the case.
	import { page } from '$app/state';
	import { ChevronRight, CircleCheck, CircleDot, Inbox } from '@lucide/svelte';
	import Frame from '$lib/runner/Frame.svelte';
	import Notice from '$lib/runner/Notice.svelte';
	import { links } from '$lib/runner/links';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const justDone = $derived(page.url.searchParams.get('done'));
	const waiting = $derived(
		data.groups.flatMap((g) => g.requests).filter((r) => r.status !== 'done').length
	);
</script>

<svelte:head><title>Requests for you</title></svelte:head>

<Frame user={data.user}>
	<div class="max-w-6xl px-4 py-8 lg:px-6">
		<header class="mb-6 px-1">
			<h1 class="text-[22px] font-semibold tracking-tight">Requests for you</h1>
			<p class="mt-1 text-[14px] text-muted-foreground">
				{waiting
					? `${waiting} ${waiting === 1 ? 'request is' : 'requests are'} waiting on you. You only see what each one needs.`
					: 'Nothing is waiting on you.'}
			</p>
		</header>

		{#if justDone}
			<Notice
				><span class="font-medium">Sent:</span> {justDone}. Thank you, they can see it now.</Notice
			>
		{/if}

		{#each data.groups as group (group.from)}
			<section class="mt-8 first-of-type:mt-0">
				<h2 class="mb-2 px-1 text-[13px] font-semibold">From {group.from}</h2>
				<ul class="divide-y overflow-hidden rounded-xl border bg-card">
					{#each group.requests as r (r.attachmentId + r.item)}
						<li>
							<a
								href={links.request(r.attachmentId, r.item)}
								class="group flex items-center gap-3 px-4 py-3.5 hover:bg-muted/50"
							>
								<span
									class="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"
								>
									{#if r.status === 'done'}<CircleCheck class="size-4" />{:else}<CircleDot
											class="size-4"
										/>{/if}
								</span>
								<div class="min-w-0 flex-1">
									<p class="text-[14px] font-medium">
										{r.title}
										{#if r.status === 'done'}<span
												class="text-[12px] font-normal text-muted-foreground">· sent</span
											>{/if}
									</p>
									<p class="mt-0.5 text-[13px] text-muted-foreground">
										Requested by {r.requester} for {r.forWhom}
									</p>
								</div>
								<ChevronRight class="size-4 shrink-0 text-muted-foreground/50" />
							</a>
						</li>
					{/each}
				</ul>
			</section>
		{:else}
			<div
				class="grid place-items-center rounded-xl border border-dashed bg-card px-6 py-16 text-center"
			>
				<Inbox class="size-6 text-muted-foreground" />
				<p class="mt-3 text-[14px] font-medium">You’re all caught up</p>
			</div>
		{/each}
	</div>
</Frame>
