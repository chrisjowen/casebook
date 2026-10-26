<script lang="ts">
	// My work: everything waiting on the signed-in user in this instance, in a fixed order:
	// questions others asked them, ready, paused for missing information, waiting on someone else,
	// and repeating work last and quiet.
	import { page } from '$app/state';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Hourglass from '@lucide/svelte/icons/hourglass';
	import Inbox from '@lucide/svelte/icons/inbox';
	import MessageCircleQuestion from '@lucide/svelte/icons/message-circle-question';
	import Frame from '$lib/runner/Frame.svelte';
	import FilterChips from '$lib/runner/FilterChips.svelte';
	import Notice from '$lib/runner/Notice.svelte';
	import Section from '$lib/runner/Section.svelte';
	import TaskRow from '$lib/runner/TaskRow.svelte';
	import { day, lowerFirst, names, relative } from '$lib/runner/format';
	import { links } from '$lib/runner/links';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const work = $derived(data.work);
	const slug = $derived(data.instance.slug);
	const me = $derived(data.user.id);
	const filter = $derived(page.url.searchParams.get('process') ?? '');
	const savedTask = $derived(page.url.searchParams.get('saved'));
	const keep = (t: { definitionSlug: string }) => !filter || t.definitionSlug === filter;
	const heldNote = (task: (typeof work.held)[number]) =>
		task.held
			? `“${task.held.note}” — ${task.held.by.id === me ? 'you' : task.held.by.name}, ${day(task.held.at)}`
			: undefined;
	// Work with a new answer to the user's question comes first in its group.
	const answeredFirst = <T extends { questions?: { answered: number } }>(list: T[]) =>
		[...list].sort((x, y) => Number(!!y.questions?.answered) - Number(!!x.questions?.answered));

	const asked = $derived(work.asked.filter(keep));
	const ready = $derived(answeredFirst(work.ready.filter(keep)));
	const held = $derived(answeredFirst(work.held.filter(keep)));
	// A process whose question is waiting on the user shows once, under Questions for you.
	const waiting = $derived(
		work.waiting.filter(
			(w) => keep(w) && !work.asked.some((q) => q.attachmentId === w.attachmentId)
		)
	);
	const recurring = $derived(work.recurring.filter(keep));
	const total = $derived(work.asked.length + work.ready.length + work.held.length);
	// One chip per process, named without the label that tells two runs on one case apart.
	const options = $derived([
		...new Map(
			[...work.asked, ...work.ready, ...work.held, ...work.recurring, ...work.waiting].map((t) => [
				t.definitionSlug,
				{ value: t.definitionSlug, label: t.process.split(' · ')[0]! }
			])
		).values()
	]);
</script>

<svelte:head><title>My work · {data.instance.name}</title></svelte:head>

<Frame user={data.user} instance={data.instance} instances={data.instances}>
	<div class="max-w-6xl px-4 py-8 lg:px-6">
		<header class="mb-6 px-1">
			<h1 class="text-[22px] font-semibold tracking-tight">My work</h1>
			<p class="mt-1 text-[14px] text-muted-foreground">
				{#if total === 0}
					Nothing needs you in {data.instance.name} right now.
				{:else}
					{total}
					{total === 1 ? 'thing needs' : 'things need'} you in {data.instance.name}.
				{/if}
			</p>
		</header>

		{#if savedTask}
			<Notice
				><span class="font-medium">Saved “{savedTask}” for later.</span>
				<span class="text-muted-foreground"
					>It is still on your list, filled in as you left it.</span
				></Notice
			>
		{/if}

		<div class="mb-6 px-1"><FilterChips {options} /></div>

		{#if asked.length}
			<Section title="Questions for you" count={asked.length} hint="Someone needs information">
				{#each asked as q (q.question.id)}
					<a
						href={links.task(slug, q.caseId, q.attachmentId, q.item)}
						class="group flex items-start gap-3 px-4 py-3.5 hover:bg-muted/50"
					>
						<span
							class="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand"
							><MessageCircleQuestion class="size-4" /></span
						>
						<div class="min-w-0 flex-1">
							<div class="text-[14px]">
								<span class="font-medium">{q.question.by.name}</span>
								<span class="text-muted-foreground">asks about “{q.title}”</span>
							</div>
							<p class="mt-1 line-clamp-2 text-[14px] text-foreground/85">“{q.question.text}”</p>
							<div
								class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground"
							>
								<span class="text-foreground/80">{q.caseTitle}</span>
								<span>{q.process}</span>
								<span>{relative(q.question.at)}</span>
							</div>
						</div>
						<ChevronRight
							class="mt-2 size-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5"
						/>
					</a>
				{/each}
			</Section>
		{/if}

		{#if ready.length}
			<Section title="Ready for you" count={ready.length}>
				{#each ready as task (task.attachmentId + task.item)}
					<TaskRow
						{task}
						{me}
						href={links.task(slug, task.caseId, task.attachmentId, task.item)}
						note={task.sentBack
							? `Sent back by ${task.sentBack.by.name}: “${task.sentBack.note}”`
							: undefined}
					/>
				{/each}
			</Section>
		{/if}

		{#if held.length}
			<Section title="Needs information" count={held.length} hint="Paused until something arrives">
				{#each held as task (task.attachmentId + task.item)}
					<TaskRow
						{task}
						{me}
						showStatus
						href={links.task(slug, task.caseId, task.attachmentId, task.item)}
						note={heldNote(task)}
					/>
				{/each}
			</Section>
		{/if}

		{#if waiting.length}
			<Section title="Waiting on someone else" count={waiting.length}>
				{#each waiting as wait (wait.attachmentId)}
					<a
						href={wait.mine
							? links.task(slug, wait.caseId, wait.attachmentId, wait.mine.item)
							: links.case(slug, wait.caseId)}
						class="flex items-start gap-3 px-4 py-3.5 hover:bg-muted/50"
					>
						<span
							class="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"
							><Hourglass class="size-4" /></span
						>
						<div class="min-w-0 flex-1">
							{#if wait.mine?.waitingOn}
								<div class="text-[14px]">
									<span class="font-medium">{names(wait.mine.waitingOn.holders)}</span>
									<span class="text-muted-foreground"
										>— {lowerFirst(wait.mine.waitingOn.title)}</span
									>
								</div>
							{/if}
							{#each wait.on as other (other.title)}
								<div class="text-[14px]">
									<span class="font-medium">{names(other.holders)}</span>
									<span class="text-muted-foreground">— {lowerFirst(other.title)}</span>
								</div>
								{#if other.held}
									<!-- Pausing notifies only whoever is waiting: this is that note. -->
									<p class="mt-1 text-[13px] text-amber-800">
										Paused by {other.held.by.name}, {day(other.held.at)}: “{other.held.note}”
									</p>
								{/if}
							{/each}
							<div
								class="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground"
							>
								<span class="text-foreground/80">{wait.caseTitle}</span>
								<span>{wait.process}</span>
								<span>Stage {wait.stage.number} of {wait.stage.count} · {wait.stage.title}</span>
							</div>
							<p class="mt-1.5 text-[13px] text-muted-foreground">
								{wait.mine
									? `“${wait.mine.title}” starts once that’s in.`
									: wait.myPartDone
										? 'Your part is done for now.'
										: 'Nothing for you to do here yet.'}
							</p>
						</div>
					</a>
				{/each}
			</Section>
		{/if}

		{#if recurring.length}
			<Section title="Recurring" count={recurring.length}>
				{#each recurring as task (task.attachmentId + task.item)}
					<TaskRow
						{task}
						{me}
						showStatus
						href={links.task(slug, task.caseId, task.attachmentId, task.item)}
						note={task.lastDone
							? `Last by ${task.lastDone.by.id === me ? 'you' : task.lastDone.by.name}, ${day(task.lastDone.at)}`
							: undefined}
					/>
				{/each}
			</Section>
		{/if}

		{#if !asked.length && !ready.length && !held.length && !waiting.length && !recurring.length}
			<div
				class="grid place-items-center rounded-xl border border-dashed bg-card px-6 py-16 text-center"
			>
				<Inbox class="size-6 text-muted-foreground" />
				<p class="mt-3 text-[14px] font-medium">You’re all caught up</p>
				<p class="mt-1 text-[13px] text-muted-foreground">
					New work shows up here when a case reaches a stage that needs you.
				</p>
			</div>
		{/if}
	</div>
</Frame>
