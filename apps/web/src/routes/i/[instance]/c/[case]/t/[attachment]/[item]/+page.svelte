<script lang="ts">
	// One task on a case, as a focused workspace: a header with where the process stands, the task's
	// form with one action bar, its questions thread, and a rail with who it is for and the
	// process's other tasks. Right after completing it, a hand-off says what comes next.
	import { page } from '$app/state';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import Workflow from '@lucide/svelte/icons/workflow';
	import Frame from '$lib/runner/Frame.svelte';
	import Notice from '$lib/runner/Notice.svelte';
	import Questions from '$lib/runner/Questions.svelte';
	import StageStrip from '$lib/runner/StageStrip.svelte';
	import StatusTag from '$lib/runner/StatusTag.svelte';
	import TaskForm from '$lib/runner/TaskForm.svelte';
	import TaskOutline from '$lib/runner/TaskOutline.svelte';
	import { lowerFirst, names } from '$lib/runner/format';
	import { links } from '$lib/runner/links';
	import ActionsMenu from '$lib/shell/ActionsMenu.svelte';
	import { taskVerbs } from '$lib/shell/actions';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const view = $derived(data.task);
	const slug = $derived(data.instance.slug);
	const c = $derived(data.case);
	const process = $derived(view.process!);
	const task = $derived(view.task);
	const me = $derived(data.user.id);
	const justDone = $derived(page.url.searchParams.get('done'));
	const doneLine = $derived(
		justDone === 'sent-back'
			? 'Sent back for changes.'
			: task.status === 'skipped'
				? 'Marked as not needed.'
				: task.repeating && task.status !== 'done'
					? 'Update posted. Thank you.'
					: 'Done. Thank you.'
	);
	const next = $derived(data.next ?? []);
	const nextHere = $derived(next.filter((t) => t.caseId === c.id).length);
	let stuck = $state(false);
	const started = $derived(page.url.searchParams.get('started'));
	// Questions waiting on the viewer's answer come first, so whoever was asked sees them at once.
	const forMe = $derived(view.questions.filter((q) => q.to.id === me && q.waiting));
	const who = $derived(
		view.you.canAct
			? task.status === 'done'
				? `You did this as ${lowerFirst(view.you.role)}.`
				: `You’re doing this as ${lowerFirst(view.you.role)}${view.you.others.length ? `; ${names(view.you.others)} can also do it` : ''}.`
			: `For ${names(task.holders, 'nobody yet')} (${lowerFirst(view.you.role)}).`
	);
</script>

<svelte:head><title>{task.title} · {c.title}</title></svelte:head>

<Frame
	user={data.user}
	instance={data.instance}
	instances={data.instances}
	crumbs={[
		{ label: c.title, href: links.case(slug, c.id) },
		{
			label: task.stage.title,
			hint: process.name,
			href: links.here(new URL(links.case(slug, c.id), 'http://x'), {
				process: process.definitionSlug
			})
		},
		{ label: task.title }
	]}
>
	{#snippet actions()}
		<ActionsMenu
			verbs={taskVerbs(slug, {
				caseId: c.id,
				attachmentId: process.id,
				item: task.item,
				definitionSlug: process.definitionSlug
			})}
			label={task.title}
			omit={['open']}
			size="sm"
		/>
	{/snippet}

	<div class="px-4 py-6 lg:px-6">
		<!-- Where this task sits: its case and process, the stages, and its status. -->
		<header class="mb-6 max-w-6xl border-b pb-5">
			<p class="mb-1 truncate text-[13px] text-muted-foreground">
				<a href={links.case(slug, c.id)} class="font-medium text-foreground/80 hover:underline"
					>{c.title}</a
				><span class="mx-1.5" aria-hidden="true">·</span>{process.name}
			</p>
			<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
				<h1 class="text-[22px] leading-tight font-semibold tracking-tight">{task.title}</h1>
				<StatusTag {task} {me} />
			</div>
			<p class="mt-1 text-[13px] text-muted-foreground">{who}</p>
			<div class="mt-4 max-w-3xl"><StageStrip stages={process.stages} /></div>
		</header>

		<div class="grid max-w-6xl gap-8 lg:grid-cols-[minmax(0,1fr)_17rem]">
			<div class="max-w-3xl min-w-0">
				{#if forMe.length}
					<div
						class="mb-6 flex flex-wrap items-start gap-3 rounded-xl border border-brand/30 bg-brand-soft px-4 py-3 text-[13px]"
						role="status"
					>
						<div class="min-w-0 flex-1">
							<p class="font-medium">
								{forMe.length > 1
									? `${forMe.length} questions for you, the first from`
									: 'A question for you from'}
								{forMe[0]!.by.name}:
							</p>
							<p class="mt-0.5 line-clamp-2 text-foreground/85">“{forMe[0]!.text}”</p>
						</div>
						<button
							type="button"
							class="h-8 cursor-pointer rounded-lg border bg-card px-3 font-medium hover:bg-muted"
							onclick={() => {
								document.getElementById('questions-heading')?.scrollIntoView({ block: 'start' });
								document.getElementById(`reply-${forMe[0]!.id}`)?.focus({ preventScroll: true });
							}}>Answer</button
						>
					</div>
				{/if}
				{#if started && !justDone}
					<Notice>
						<span class="font-medium">Started {started} for {c.title}.</span>
						<span class="text-muted-foreground"
							>This is the first task, and it’s yours. It saves as you type, so you can finish it
							later.</span
						>
					</Notice>
				{/if}
				{#if justDone}
					<!-- The hand-off: never a dead end after finishing something. -->
					<div class="mb-8 rounded-xl border bg-card px-5 py-5" role="status">
						<p class="flex items-center gap-2 text-[15px] font-semibold">
							<CircleCheck class="size-5 text-emerald-600" />
							{doneLine}
						</p>
						{#if view.others && !/^(Nobody else|Nothing is)/.test(view.others)}
							<p class="mt-1.5 ml-7 text-[13px] text-muted-foreground">{view.others}</p>
						{/if}
						<div class="mt-4 ml-7 flex flex-wrap items-center gap-3">
							{#if next.length}
								<a
									href={links.task(slug, next[0]!.caseId, next[0]!.attachmentId, next[0]!.item)}
									class="flex h-10 items-center gap-2 rounded-lg bg-foreground px-4 text-[14px] font-medium text-background hover:bg-foreground/90"
								>
									Next: {next[0]!.title}{next[0]!.caseId !== c.id ? ` · ${next[0]!.caseTitle}` : ''}
									<ArrowRight class="size-4" />
								</a>
								<a
									href={links.myWork(slug)}
									class="text-[13px] text-muted-foreground hover:text-foreground">Back to My work</a
								>
								{#if next.length > 1}
									<p class="w-full text-[13px] text-muted-foreground">
										{nextHere > 1
											? `You have ${nextHere} tasks ready on this case. Also:`
											: 'Also ready for you:'}
										{#each next.slice(1) as t, i (t.attachmentId + t.item)}{i ? ', ' : ' '}<a
												href={links.task(slug, t.caseId, t.attachmentId, t.item)}
												class="font-medium text-foreground underline-offset-2 hover:underline"
												>{t.title}</a
											>{t.caseId !== c.id ? ` (${t.caseTitle})` : ''}{/each}
									</p>
								{/if}
							{:else}
								<p class="text-[13px]">Nothing else is waiting on you right now.</p>
								<a
									href={links.case(slug, c.id)}
									class="flex h-9 items-center rounded-lg border px-3 text-[13px] font-medium hover:bg-muted"
									>Back to the case</a
								>
								<a
									href={links.myWork(slug)}
									class="text-[13px] text-muted-foreground hover:text-foreground">My work</a
								>
							{/if}
						</div>
					</div>
				{/if}

				<TaskForm
					bind:stuck
					{view}
					{me}
					{form}
					demoFiles={data.demoFiles}
					showHeader={false}
					taskHref={(attachment, item) => links.task(slug, c.id, attachment, item)}
				/>

				{#if view.questions.length || view.askable.length}
					<Questions
						questions={view.questions}
						askable={view.askable}
						{me}
						onAsk={stuck ? undefined : () => (stuck = true)}
					/>
				{/if}
			</div>

			<aside class="grid content-start gap-6 lg:sticky lg:top-4 lg:self-start">
				<section class="text-[13px]">
					<div class="mb-2 flex items-center px-2">
						<h2 class="text-[12px] font-semibold tracking-wide text-muted-foreground uppercase">
							In this process
						</h2>
						<a
							href={links.wholeProcess(slug, c.id, process.id)}
							class="ml-auto flex items-center gap-1 rounded px-1 text-[12px] text-muted-foreground hover:text-foreground"
							title="View the whole process"><Workflow class="size-3.5" />Whole process</a
						>
					</div>
					<TaskOutline
						stages={view.outline}
						current={task.item}
						href={(item) => links.task(slug, c.id, process.id, item)}
					/>
				</section>
			</aside>
		</div>
	</div>
</Frame>
