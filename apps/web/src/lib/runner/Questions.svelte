<script lang="ts">
	// Questions on a task: threads asking a named person for information the task needs, which
	// they answer from My work. Asking happens in the task's "I can't finish this yet" panel
	// (`onAsk` opens it); whoever asked, was asked or can do the task replies and marks it resolved.
	import { enhance } from '$app/forms';
	import {
		CircleCheck,
		Hourglass,
		MessageCircleQuestion,
		MessageSquareReply
	} from '@lucide/svelte';
	import type { PersonView, QuestionView } from '@casebook/store';
	import { relative } from './format';

	let {
		questions,
		askable,
		me,
		onAsk
	}: {
		questions: QuestionView[];
		/** Who can be asked; empty when the actor cannot ask. */
		askable: PersonView[];
		me: string;
		/** Opens the task's panel for asking someone; unset when the actor cannot ask. */
		onAsk?: () => void;
	} = $props();

	const you = (p: PersonView) => (p.id === me ? 'you' : p.name);
	const You = (p: PersonView) => (p.id === me ? 'You' : p.name);
	let sent = $state('');
	const input =
		'rounded-lg border bg-background px-3 py-2 text-[14px] outline-none focus:ring-2 focus:ring-brand-ring';
</script>

<section class="mt-10" aria-labelledby="questions-heading">
	<div class="mb-3 flex items-center gap-2">
		<h2 id="questions-heading" class="text-[13px] font-semibold">Questions</h2>
		{#if questions.length}<span class="text-[13px] text-muted-foreground">{questions.length}</span
			>{/if}
		{#if askable.length && onAsk}
			<button
				type="button"
				class="ml-auto flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border bg-card px-3 text-[13px] font-medium hover:bg-muted"
				onclick={onAsk}><MessageCircleQuestion class="size-4" />Ask for information</button
			>
		{/if}
	</div>

	{#if questions.length}
		<ul class="grid gap-3">
			{#each questions as q (q.id)}
				<li class={['rounded-xl border bg-card', q.resolved && 'opacity-75']}>
					<div class="flex items-start gap-3 px-5 pt-4">
						<div class="min-w-0 flex-1">
							<p class="text-[12px] text-muted-foreground">
								<span class="font-medium text-foreground">{You(q.by)}</span> asked
								<span class="font-medium text-foreground">{you(q.to)}</span> · {relative(q.at)}
							</p>
							<p class="mt-1 text-[14px] leading-relaxed whitespace-pre-line">{q.text}</p>
						</div>
						{#if q.resolved}
							<span
								class="flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium text-muted-foreground"
								><CircleCheck class="size-3" />Resolved</span
							>
						{:else if q.waiting}
							<span
								class="flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[12px] font-medium text-muted-foreground"
								><Hourglass class="size-3" />Waiting for {you(q.to)}</span
							>
						{:else}
							<span
								class="flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[12px] font-medium text-emerald-800"
								><MessageSquareReply class="size-3" />Answered</span
							>
						{/if}
					</div>
					{#if q.replies.length}
						<ul class="mx-5 mt-3 grid gap-3 border-l-2 border-border pl-4">
							{#each q.replies as r, i (i)}
								<li>
									<p class="text-[12px] text-muted-foreground">
										<span class="font-medium text-foreground">{You(r.by)}</span> · {relative(r.at)}
									</p>
									<p class="mt-0.5 text-[14px] leading-relaxed whitespace-pre-line">{r.text}</p>
								</li>
							{/each}
						</ul>
					{/if}
					{#if q.canReply && !q.resolved}
						<div class="mt-3 flex flex-wrap items-end gap-2 border-t px-5 py-3">
							<form
								method="POST"
								action="?/reply"
								class="flex min-w-0 flex-1 items-end gap-2"
								use:enhance={() =>
									async ({ result, update }) => {
										await update();
										if (result.type === 'success')
											sent = q.to.id === me ? `Answer sent to ${q.by.name}.` : 'Reply sent.';
									}}
							>
								<input type="hidden" name="question" value={q.id} />
								<label for="reply-{q.id}" class="sr-only"
									>Reply to {q.by.id === me ? q.to.name : q.by.name}</label
								>
								<textarea
									id="reply-{q.id}"
									name="text"
									rows="1"
									class="{input} min-h-9 min-w-0 flex-1 resize-y py-1.5"
									placeholder={q.to.id === me ? 'Write your answer' : 'Write a reply'}></textarea>
								<button
									class="h-9 shrink-0 cursor-pointer rounded-lg border px-3 text-[13px] font-medium hover:bg-muted"
									>{q.to.id === me ? 'Answer' : 'Reply'}</button
								>
							</form>
							<form method="POST" action="?/resolve" use:enhance>
								<input type="hidden" name="question" value={q.id} />
								<button
									class="h-9 cursor-pointer rounded-lg px-3 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground"
									>Mark resolved</button
								>
							</form>
						</div>
					{:else}
						<div class="h-4"></div>
					{/if}
				</li>
			{/each}
		</ul>
		{#if sent}<p class="mt-2 text-[13px] text-muted-foreground" role="status">{sent}</p>{/if}
	{:else}
		<p class="rounded-xl border border-dashed px-5 py-4 text-[13px] text-muted-foreground">
			{askable.length
				? 'If something this task needs is missing, ask whoever has it. They answer here, and you carry on.'
				: 'No questions on this task.'}
		</p>
	{/if}
</section>
