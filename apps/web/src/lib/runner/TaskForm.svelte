<script lang="ts">
	// One focused task: its status in plain words, what it uses (values already on the case, with
	// where they came from), and what to record, with one action bar: complete it, save it to
	// finish later, or say what is missing (asking someone for it). Members and guests share it; a
	// guest's view holds only their own form's data. There is no claim button: whoever finishes
	// first completes it, and starting to fill it in tells the others who is on it.
	import { tick } from 'svelte';
	import { deserialize, enhance } from '$app/forms';
	import { beforeNavigate } from '$app/navigation';
	import {
		ChevronRight,
		CircleAlert,
		CircleCheck,
		CircleSlash,
		Hourglass,
		Lock,
		Repeat,
		Undo2
	} from '@lucide/svelte';
	import type { ResolvedPathname } from '$app/types';
	import type { TaskView } from '@casebook/store';
	import FactField from './FactField.svelte';
	import { links } from './links';
	import { day, lowerFirst, names, onlyWhen, relative, when } from './format';

	type Failure = { code?: string; reason?: string; problems?: Record<string, string> };

	let {
		view,
		me,
		form,
		taskHref,
		demoFiles = false,
		showHeader = true,
		stuck = $bindable(false)
	}: {
		view: TaskView;
		me: string;
		/** The last action's result, if it failed. */
		form?: Failure | Record<string, unknown> | null;
		/** Links to the task a recorded value came from; unset for guests. */
		taskHref?: (attachmentId: string, item: string) => ResolvedPathname;
		demoFiles?: boolean;
		/** The page shows the title itself, above the form. */
		showHeader?: boolean;
		/** The "I can't finish this yet" panel is open: say what's missing, and ask someone. */
		stuck?: boolean;
	} = $props();

	const task = $derived(view.task);
	const failure = $derived((form ?? {}) as Failure);
	const problems = $derived(failure.problems ?? {});
	const open = $derived(['ready', 'held'].includes(task.status));
	const canAct = $derived(view.you.canAct && open);
	const othersStarted = $derived(task.started.filter((s) => s.by.id !== me));
	const verb = $derived(
		task.kind === 'decision' ? 'Record decision' : task.repeating ? 'Post update' : 'Complete task'
	);

	const who = $derived(
		view.you.canAct
			? task.status === 'done'
				? `You did this as ${lowerFirst(view.you.role)}.`
				: `You’re doing this as ${lowerFirst(view.you.role)}${view.you.others.length ? `; ${names(view.you.others)} can also do it` : ''}.`
			: `For ${names(task.holders, 'nobody yet')} (${lowerFirst(view.you.role)}).`
	);

	const repeating = $derived(
		[
			task.lastDone &&
				`Last posted by ${task.lastDone.by.id === me ? 'you' : task.lastDone.by.name}, ${when(task.lastDone.at)}.`,
			task.due && `Next one ${task.overdue ? 'was due' : 'due'} ${relative(task.due)}.`
		]
			.filter(Boolean)
			.join(' ')
	);

	// A saved draft reopens the form where it was left; files wait for completion.
	// A decision's outcome named after it, "Big spend? outcome", is asked as the decision itself.
	const fields = $derived(
		view.fields.map((f) => {
			const saved = view.draft?.values[f.fact];
			const asked =
				task.kind === 'decision' && f.title === `${task.title} outcome`
					? { ...f, title: task.title }
					: f;
			return saved && f.kind !== 'file'
				? { ...asked, current: { raw: saved, display: saved.join(', ') } }
				: asked;
		})
	);
	const hasFiles = $derived(view.evidence.length > 0 || view.fields.some((f) => f.kind === 'file'));
	const answered = $derived(view.questions.filter((q) => !q.resolved && !q.waiting));
	// Whoever was asked sees the question once, above, not again as the pause it caused.
	const askedMe = $derived(view.questions.some((q) => q.to.id === me && q.waiting));
	/** The newest answer from someone who was asked, shown where the pause is explained. */
	const answer = $derived.by(() => {
		for (const q of [...answered].reverse()) {
			const reply = [...q.replies].reverse().find((r) => r.by.id === q.to.id);
			if (reply) return { ...reply, question: q.text };
		}
		return undefined;
	});

	// Typed values are saved as a draft as people go, so nothing is lost on a reload, a question
	// or a visit elsewhere; files wait for completion.
	let formEl = $state<HTMLFormElement>();
	let dirty = false;
	let finishing = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let saving: Promise<void> = Promise.resolve();
	let savedAt = $state<string>();
	let saveFailed = $state<string>();
	let savedNote = $state('');
	// Saving keeps typed values, so a task with nothing to record has nothing to save.
	const canSave = $derived(
		canAct && task.kind !== 'approval' && (view.fields.length > 0 || view.evidence.length > 0)
	);
	function draftBody() {
		const body = new FormData(formEl);
		for (const key of [...body.keys()]) if (!key.startsWith('value:')) body.delete(key);
		return body;
	}
	function saveNow() {
		clearTimeout(timer);
		saving = saving.then(sendDraft);
		return saving;
	}
	async function sendDraft() {
		if (finishing || !dirty || !formEl || !canSave) return;
		dirty = false;
		let reason = 'Something went wrong.';
		try {
			const response = await fetch('?/save', {
				method: 'POST',
				body: draftBody(),
				headers: { 'x-sveltekit-action': 'true' }
			});
			const result = deserialize(await response.text());
			if (result.type === 'success') {
				savedAt = new Date().toISOString();
				saveFailed = undefined;
				return;
			}
			if (result.type === 'failure')
				reason = (result.data as Failure | undefined)?.reason || reason;
		} catch {
			reason = 'The server could not be reached, or you were signed out.';
		}
		dirty = true;
		saveFailed = reason;
	}
	function touched() {
		if (finishing) return;
		started();
		if (!canSave) return;
		dirty = true;
		clearTimeout(timer);
		timer = setTimeout(saveNow, 1500);
	}
	beforeNavigate(() => void saveNow());
	$effect(() => {
		const flush = () => {
			if (!finishing && dirty && formEl && canSave) navigator.sendBeacon('?/save', draftBody());
		};
		window.addEventListener('pagehide', flush);
		return () => window.removeEventListener('pagehide', flush);
	});
	const lastSave = $derived(
		savedAt
			? { by: 'you', at: savedAt }
			: view.draft
				? { by: view.draft.by.id === me ? 'you' : view.draft.by.name, at: view.draft.at }
				: undefined
	);

	// The stuck panel opens in view, with its first field ready.
	let chosenHelper = $state('');
	$effect(() => {
		if (!stuck) return;
		void tick().then(() => {
			const note = document.getElementById('hold-note');
			note?.scrollIntoView({ block: 'center', behavior: 'smooth' });
			note?.focus({ preventScroll: true });
		});
	});
	const helperName = $derived(view.askable.find((p) => p.id === chosenHelper)?.name);
	let skipping = $state(false);
	let told = false;
	const occurrence = $derived(task.lastDone?.at);
	$effect(() => {
		void occurrence;
		savedAt = undefined;
		saveFailed = undefined;
		savedNote = '';
		told = false;
	});
	/** Tells the others someone has started on it, once, as soon as the form is touched. */
	function started() {
		if (told || !canAct) return;
		told = true;
		void fetch('?/start', {
			method: 'POST',
			body: new FormData(),
			headers: { 'x-sveltekit-action': 'true' }
		});
	}
</script>

{#if showHeader}
	<header class="flex items-start gap-3">
		<div class="min-w-0">
			<h1 class="text-[22px] leading-tight font-semibold tracking-tight">{task.title}</h1>
			<p class="mt-1 text-[13px] text-muted-foreground">{who}</p>
		</div>
	</header>
{/if}
{#if view.requester}
	<p class="mt-3 text-[13px] text-muted-foreground">
		Requested by <span class="font-medium text-foreground">{view.requester.name}</span> for {view
			.case.title}.
	</p>
{/if}
{#if view.content}
	<p class="mt-4 text-[14px] leading-relaxed text-foreground/85">{view.content}</p>
{/if}
{#if view.guard}
	<p class="mt-2 text-[13px] text-muted-foreground">{onlyWhen(view.guard.text)}.</p>
{/if}
{#if view.reviews}
	<p class="mt-2 text-[13px] text-muted-foreground">
		{`Reviews “${view.reviews.title}”${view.reviews.doneBy ? `, done by ${view.reviews.doneBy.name}` : ''}.`}
	</p>
{/if}

<!-- Status, in plain words, before the form. -->
{#if othersStarted.length && open}
	<p class="mt-5 text-[13px] text-muted-foreground">
		{othersStarted.map((s) => s.by.name).join(' and ')} started this {relative(
			othersStarted[0]!.at
		)}.{view.you.canAct ? ' Whoever finishes first completes it.' : ''}
	</p>
{/if}
{#if task.sentBack && open}
	<div class="mt-6 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px]">
		<Undo2 class="mt-0.5 size-4 shrink-0 text-amber-700" />
		<p class="text-amber-900">
			<span class="font-medium">Sent back by {task.sentBack.by.name}</span>, {day(
				task.sentBack.at
			)}: “{task.sentBack.note}”
		</p>
	</div>
{/if}
{#if task.status === 'held' && task.held && !askedMe}
	<div class="mt-6 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px]">
		<CircleAlert class="mt-0.5 size-4 shrink-0 text-amber-700" />
		<div class="flex-1">
			<p class="font-medium text-amber-900">Paused — waiting for information</p>
			<p class="mt-0.5 text-amber-900/80">
				“{task.held.note}” — {task.held.by.id === me ? 'you' : task.held.by.name}, {day(
					task.held.at
				)}
			</p>
			{#if answer}
				<div
					class="mt-2.5 rounded-lg border border-amber-200 bg-background px-3 py-2 text-foreground"
				>
					<p class="text-[12px] text-muted-foreground">
						{answer.by.id === me ? 'You' : answer.by.name} answered {relative(answer.at) === 'now'
							? 'just now'
							: relative(answer.at)}:
					</p>
					<p class="mt-0.5 text-[14px] whitespace-pre-line">{answer.text}</p>
				</div>
			{/if}
		</div>
		{#if view.you.canAct}
			<form method="POST" action="?/resume" use:enhance>
				<button
					class="cursor-pointer rounded-lg border border-amber-300 bg-background px-3 py-1.5 font-medium hover:bg-amber-100"
					>{answer ? 'Got it — resume' : 'It’s arrived — resume'}</button
				>
			</form>
		{/if}
	</div>
{:else if view.requester && (task.status === 'waiting' || task.status === 'blocked')}
	<div class="mt-6 flex gap-3 rounded-xl border bg-muted/60 px-4 py-3 text-[13px]">
		<Hourglass class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
		<p class="text-muted-foreground">This opens once the information it needs is in.</p>
	</div>
{:else if task.status === 'waiting' && task.waitingOn}
	<div class="mt-6 flex gap-3 rounded-xl border bg-muted/60 px-4 py-3 text-[13px]">
		<Hourglass class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
		<p>
			{#if task.waitingOn.holders.some((h) => h.id === me)}
				<span class="font-medium">Do “{task.waitingOn.title}” first.</span>
				<span class="text-muted-foreground">This needs what it records.</span>
			{:else}
				<span class="font-medium">Waiting on {names(task.waitingOn.holders)}</span>
				<span class="text-muted-foreground">
					to {lowerFirst(task.waitingOn.title)}. You can start once that’s in.</span
				>
			{/if}
			{#if task.waitingOn.held}
				<span class="mt-1 block text-amber-800"
					>Paused by {task.waitingOn.held.by.name}: “{task.waitingOn.held.note}”</span
				>
			{/if}
		</p>
	</div>
{:else if task.status === 'blocked'}
	<div class="mt-6 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px]">
		<CircleAlert class="mt-0.5 size-4 shrink-0 text-amber-700" />
		<p class="text-amber-900">
			Some information this task needs hasn’t been recorded, and nothing left in the process records
			it.
		</p>
	</div>
{:else if task.status === 'upcoming'}
	<div class="mt-6 flex gap-3 rounded-xl border bg-muted/60 px-4 py-3 text-[13px]">
		<Lock class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
		<p class="text-muted-foreground">
			{task.kind === 'approval' && view.reviews
				? `This opens once “${view.reviews.title}” is done.`
				: `This opens when the case reaches ${task.stage.title}.`}
		</p>
	</div>
{:else if task.status === 'done' && task.lastDone}
	<div class="mt-6 flex gap-3 rounded-xl border bg-card px-4 py-3 text-[13px]">
		<CircleCheck class="mt-0.5 size-4 shrink-0 text-emerald-600" />
		<p>
			<span class="font-medium">Done</span>
			<span class="text-muted-foreground"
				>by {task.lastDone.by.id === me ? 'you' : task.lastDone.by.name}, {when(
					task.lastDone.at
				)}</span
			>
		</p>
	</div>
{:else if task.status === 'skipped'}
	<div class="mt-6 flex gap-3 rounded-xl border bg-card px-4 py-3 text-[13px]">
		<CircleSlash class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
		<p class="text-muted-foreground">Not needed on this case.</p>
	</div>
{:else if task.repeating}
	<div class="mt-6 flex gap-3 rounded-xl border bg-card px-4 py-3 text-[13px]">
		<Repeat class="mt-0.5 size-4 shrink-0 text-brand" />
		<p>
			<span class="font-medium"
				>{view.repeat ? `Repeats ${lowerFirst(view.repeat.text)}.` : 'Repeats.'}</span
			>
			<span class="text-muted-foreground">{repeating}</span>
		</p>
	</div>
{/if}

{#if view.uses.length}
	<!-- Folded to one line when everything it uses is in; open when something is missing. -->
	<details class="group mt-8" open={view.uses.some((u) => !u.recorded)}>
		<summary
			class="mb-2 flex cursor-pointer list-none items-baseline gap-2 text-[13px] [&::-webkit-details-marker]:hidden"
		>
			<ChevronRight
				class="size-3.5 shrink-0 self-center text-muted-foreground transition-transform group-open:rotate-90"
			/>
			<h2 class="shrink-0 font-semibold">What this uses</h2>
			<span class="truncate text-muted-foreground group-open:hidden"
				>{view.uses
					.map((u) => (u.recorded ? `${u.title}: ${u.recorded.display}` : u.title))
					.join(' · ')}</span
			>
		</summary>
		<dl class="divide-y rounded-xl border bg-card">
			{#each view.uses as use (use.fact)}
				<div
					class="grid gap-x-4 gap-y-0.5 px-4 py-3 text-[13px] sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
				>
					<dt class="text-muted-foreground">{use.title}</dt>
					<dd>
						{#if use.recorded}
							{#if use.recorded.file}
								<a
									href={links.file(use.recorded.file.id)}
									target="_blank"
									rel="noopener"
									class="font-medium underline-offset-2 hover:underline">{use.recorded.display}</a
								>
							{:else}
								<span class="font-medium break-words">{use.recorded.display}</span>
							{/if}
							<span class="block text-[12px] text-muted-foreground">
								{use.recorded.by ? `${use.recorded.by.name}, ` : ''}{day(
									use.recorded.at
								)}{#if use.recorded.from && taskHref}<span class="mx-1" aria-hidden="true">·</span
									><a
										class="underline-offset-2 hover:underline"
										href={taskHref(use.recorded.from.attachmentId, use.recorded.from.item)}
										>{use.recorded.from.title}</a
									>{/if}
							</span>
						{:else}
							<span class="text-amber-800">Not recorded yet</span>
						{/if}
					</dd>
				</div>
			{/each}
		</dl>
	</details>
{/if}

{#if failure.reason && !Object.keys(problems).length}
	<div
		class="mt-6 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-[13px] text-destructive"
		role="alert"
	>
		{failure.reason}
	</div>
{/if}

{#if task.status === 'done' || task.status === 'skipped'}
	{#if view.fields.some((f) => f.current)}
		<section class="mt-8">
			<h2 class="mb-2 text-[13px] font-semibold">What was recorded</h2>
			<dl class="divide-y rounded-xl border bg-card">
				{#each view.fields as field (field.fact)}
					<div
						class="grid gap-x-4 px-4 py-3 text-[13px] sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
					>
						<dt class="text-muted-foreground">{field.title}</dt>
						<dd class="font-medium">
							{#if field.current?.file}
								<a
									href={links.file(field.current.file.id)}
									target="_blank"
									rel="noopener"
									class="underline-offset-2 hover:underline">{field.current.file.name}</a
								>
							{:else}
								{field.current?.display ?? '—'}
							{/if}
						</dd>
					</div>
				{/each}
			</dl>
		</section>
	{/if}
{:else if view.you.canAct && task.status !== 'upcoming'}
	{#if task.kind === 'approval'}
		<form method="POST" action="?/decide" use:enhance class="mt-8">
			<input type="hidden" name="title" value={task.title} />
			<fieldset
				disabled={!canAct}
				class="grid gap-3 rounded-xl border bg-card px-5 py-5 disabled:opacity-60"
			>
				<legend class="sr-only">Your review</legend>
				<h2 class="text-[13px] font-semibold">Your review</h2>
				<div class="flex flex-wrap gap-2">
					{#each [['approve', 'Sign off'], ['send-back', 'Send back with changes']] as [value, label] (value)}
						<label
							class="flex cursor-pointer items-center gap-2 rounded-lg border bg-background px-3 py-2 text-[13px] has-checked:border-brand has-checked:bg-brand-soft"
						>
							<input type="radio" name="verdict" {value} class="accent-brand" />{label}
						</label>
					{/each}
				</div>
				{#if problems.verdict}<p class="text-[12px] font-medium text-destructive">
						{problems.verdict}
					</p>{/if}
				<label for="note" class="mt-1 text-[13px] font-medium"
					>What needs to change <span class="font-normal text-muted-foreground"
						>(needed to send it back)</span
					></label
				>
				<textarea
					id="note"
					name="note"
					rows="2"
					class="rounded-lg border bg-background px-3 py-2 text-[14px]"></textarea>
				{#if problems.note}<p class="text-[12px] font-medium text-destructive">
						{problems.note}
					</p>{/if}
			</fieldset>
			{#if canAct}
				<button
					class="mt-5 h-10 cursor-pointer rounded-lg bg-foreground px-5 text-[14px] font-medium text-background hover:bg-foreground/90"
					>Submit review</button
				>
			{/if}
		</form>
	{:else}
		<form
			method="POST"
			action="?/complete"
			enctype="multipart/form-data"
			bind:this={formEl}
			use:enhance={async ({ action }) => {
				if (!action.search.includes('save')) {
					finishing = true;
					clearTimeout(timer);
					await saving;
					dirty = false;
				}
				return async ({ result, update }) => {
					if (result.type === 'success') {
						savedAt = new Date().toISOString();
						saveFailed = undefined;
					}
					const failed = finishing && result.type !== 'redirect' && result.type !== 'success';
					await update({ reset: false });
					finishing = false;
					if (failed) dirty = canSave;
				};
			}}
			class="mt-8"
			oninput={touched}
			onchange={touched}
		>
			<input type="hidden" name="title" value={task.title} />
			{#if Object.keys(problems).length}
				<div
					class="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-[13px]"
					role="alert"
				>
					<p class="font-medium text-destructive">Some things need another look</p>
					<ul class="mt-1 list-disc pl-5 text-destructive/90">
						{#each Object.values(problems) as message (message)}<li>{message}</li>{/each}
					</ul>
				</div>
			{/if}

			<fieldset
				disabled={!canAct}
				class="grid gap-5 rounded-xl border bg-card px-5 py-5 disabled:opacity-60"
			>
				<legend class="sr-only">What to record</legend>
				<h2 class="-mb-1 text-[13px] font-semibold">
					{task.kind === 'decision' ? 'Your decision' : 'What to record'}
				</h2>
				{#each fields as field (field.fact)}
					<FactField {field} error={problems[field.fact]} {demoFiles} />
				{/each}
				{#each view.evidence as ev (ev.slot)}
					<div class="grid gap-1.5 text-[13px]">
						<span class="font-medium">{ev.description}</span>
						<span class="text-[12px] text-muted-foreground"
							>Attach a copy{#if ev.formats.length}: {ev.formats.join(' or ')}{/if}</span
						>
						<input type="file" name="file:{ev.slot}" class="text-[13px] text-muted-foreground" />
						{#if problems[ev.slot]}<p class="text-[12px] font-medium text-destructive">
								{problems[ev.slot]}
							</p>{/if}
					</div>
				{/each}
				{#if !view.fields.length && !view.evidence.length}
					<p class="text-[13px] text-muted-foreground">Nothing to record: just mark it done.</p>
				{/if}
			</fieldset>

			{#if canAct}
				<div
					class="sticky bottom-3 z-10 mt-5 flex flex-wrap items-center gap-2 rounded-xl border bg-card/95 px-3 py-2.5 shadow-sm backdrop-blur"
				>
					<button
						class="h-10 cursor-pointer rounded-lg bg-foreground px-5 text-[14px] font-medium text-background hover:bg-foreground/90"
						>{verb}</button
					>
					{#if canSave}
						<button
							formaction="?/save"
							formnovalidate
							name="leave"
							value="yes"
							class="h-10 cursor-pointer rounded-lg border bg-card px-3 text-[14px] font-medium hover:bg-muted sm:px-4"
							><span class="sm:hidden">Save</span><span class="hidden sm:inline"
								>Save for later</span
							></button
						>
					{/if}
					{#if task.status !== 'held'}
						<button
							type="button"
							aria-expanded={stuck}
							aria-controls="stuck"
							class="h-10 cursor-pointer rounded-lg px-2 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground sm:px-3"
							onclick={() => (stuck = !stuck)}>I can’t finish this yet</button
						>
					{/if}
					{#if view.canSkip}
						<button
							type="button"
							class="h-10 cursor-pointer rounded-lg px-3 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground"
							onclick={() => (skipping = !skipping)}
							>{task.repeating ? 'Stop repeating' : 'This doesn’t apply'}</button
						>
					{/if}
					<span
						class="ml-auto text-[12px] text-muted-foreground sm:inline {saveFailed ? '' : 'hidden'}"
						role="status"
					>
						{#if saveFailed}
							<span class="text-destructive">Not saved: {saveFailed}</span>
						{:else if lastSave}
							Saved{lastSave.by === 'you' ? '' : ` by ${lastSave.by}`}
							{relative(lastSave.at)}{hasFiles ? '. Files attach when you complete it.' : '.'}
						{:else if canSave}
							Saved as you type.
						{/if}
					</span>
				</div>
			{/if}
		</form>

		{#if stuck}
			<form
				id="stuck"
				method="POST"
				action="?/hold"
				use:enhance={async () => {
					await saveNow();
					const asked = helperName;
					return async ({ result, update }) => {
						await update();
						if (result.type === 'success') {
							savedNote = asked ? `Question sent to ${asked}.` : 'Paused.';
							stuck = false;
							chosenHelper = '';
						}
					};
				}}
				class="mt-4 grid gap-3 rounded-xl border bg-card px-5 py-4"
			>
				<h2 class="text-[13px] font-semibold">
					{task.status === 'held' ? 'Ask for information' : 'What’s stopping you?'}
				</h2>
				<div class="grid gap-1.5">
					<label for="hold-note" class="text-[13px] font-medium"
						>{helperName ? `What do you need from ${helperName}?` : 'What’s missing?'}</label
					>
					<textarea
						id="hold-note"
						name="note"
						rows="2"
						placeholder={helperName
							? 'e.g. Which hospital sent the bill, and on what date?'
							: 'e.g. A document I need hasn’t arrived yet'}
						class="rounded-lg border bg-background px-3 py-2 text-[14px]"></textarea>
					{#if problems.note || problems.text}<p class="text-[12px] font-medium text-destructive">
							{problems.note ?? problems.text}
						</p>{/if}
				</div>
				{#if view.askable.length}
					<div class="grid gap-1.5">
						<label for="hold-to" class="text-[13px] font-medium">Can someone here help?</label>
						<select
							id="hold-to"
							name="to"
							bind:value={chosenHelper}
							class="h-10 rounded-lg border bg-background px-3 text-[14px]"
						>
							<option value="">No — I’m waiting on something outside</option>
							{#each view.askable as p (p.id)}<option value={p.id}>Ask {p.name}</option>{/each}
						</select>
						{#if problems.to}<p class="text-[12px] font-medium text-destructive">
								{problems.to}
							</p>{/if}
					</div>
				{/if}
				{#if helperName && task.status === 'ready'}
					<label class="flex items-center gap-2 text-[13px]">
						<input type="checkbox" name="pause" value="yes" checked class="accent-brand" />
						Pause this task until they answer
					</label>
				{/if}
				<div class="flex flex-wrap items-center gap-2">
					<button
						class="h-9 cursor-pointer rounded-lg bg-foreground px-4 text-[13px] font-medium text-background hover:bg-foreground/90"
						>{helperName ? 'Send question' : 'Pause this task'}</button
					>
					<button
						type="button"
						class="h-9 cursor-pointer rounded-lg px-3 text-[13px] text-muted-foreground hover:bg-muted"
						onclick={() => (stuck = false)}>Cancel</button
					>
					<span class="text-[12px] text-muted-foreground">
						{helperName
							? `${helperName} sees it at the top of My work and answers on this task.`
							: 'It moves to “Needs information”, and whoever is waiting on it sees why.'}
					</span>
				</div>
			</form>
		{/if}
		{#if savedNote}
			<p class="mt-3 text-[13px] text-muted-foreground" role="status">{savedNote}</p>
		{/if}
		{#if skipping}
			<form
				method="POST"
				action="?/skip"
				use:enhance
				class="mt-4 grid gap-2 rounded-xl border bg-card px-5 py-4"
			>
				<label for="skip-reason" class="text-[13px] font-medium"
					>Why doesn’t it apply{#if view.guard}? It applies {lowerFirst(
							view.guard.text
						)}{/if}</label
				>
				<textarea
					id="skip-reason"
					name="reason"
					rows="2"
					class="rounded-lg border bg-background px-3 py-2 text-[14px]"></textarea>
				<div>
					<button
						class="h-9 cursor-pointer rounded-lg border px-4 text-[13px] font-medium hover:bg-muted"
						>{task.repeating ? 'Stop repeating' : 'Skip it'}</button
					>
				</div>
			</form>
		{/if}
	{/if}
{:else if !view.you.canAct && open}
	<p
		class="mt-8 rounded-xl border border-dashed bg-card px-5 py-4 text-[13px] text-muted-foreground"
	>
		This is for {names(task.holders, 'nobody yet')}; you can follow it here.
	</p>
{/if}
