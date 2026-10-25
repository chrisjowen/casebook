<script lang="ts">
	// One task in a list: what it is, which case and process, where the process stands.
	import { ChevronRight, MessageSquareReply } from '@lucide/svelte';
	import type { ResolvedPathname } from '$app/types';
	import type { TaskSummary } from '@casebook/store';
	import ItemIcon from './ItemIcon.svelte';
	import StatusTag from './StatusTag.svelte';

	let {
		task,
		href,
		me,
		showCase = true,
		showStatus = false,
		note
	}: {
		task: TaskSummary;
		href: ResolvedPathname;
		/** The signed-in user, who is not told that they started it. */
		me: string;
		showCase?: boolean;
		showStatus?: boolean;
		note?: string;
	} = $props();

	// No claim button: whoever finishes first wins, so others just see who has started.
	const started = $derived(task.started.filter((s) => s.by.id !== me).map((s) => s.by.name));
</script>

<a
	{href}
	class="group flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
>
	<ItemIcon kind={task.kind} />
	<div class="min-w-0 flex-1">
		<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
			<span class="text-[14px] font-medium">{task.title}</span>
			{#if showStatus}<StatusTag {task} {me} />{/if}
			{#if task.questions?.answered}
				<span
					class="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[12px] font-medium text-emerald-800"
					><MessageSquareReply class="size-3" />{task.questions.answered === 1
						? 'New answer'
						: `${task.questions.answered} new answers`}</span
				>
			{/if}
		</div>
		<div
			class="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground"
		>
			{#if showCase}<span class="text-foreground/80">{task.caseTitle}</span>{/if}
			<span>{task.process}</span>
			<span>Stage {task.stage.number} of {task.stage.count} · {task.stage.title}</span>
		</div>
		{#if note}<p class="mt-1.5 text-[13px] text-muted-foreground">{note}</p>{/if}
		{#if started.length}
			<p class="mt-1.5 text-[12px] text-muted-foreground">{started.join(' and ')} started this</p>
		{/if}
	</div>
	<ChevronRight
		class="size-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5"
	/>
</a>
