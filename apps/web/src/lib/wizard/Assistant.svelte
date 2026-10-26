<script lang="ts">
	// The spreadsheet import's assistant (ADR 0011), a closeable slide-over beside the board: the
	// conversation with the authoring agent, its split proposal to rename, merge, split and accept,
	// and each drafted turn as a proposal to accept or reject. The proposal itself is drawn on the
	// board. Every request goes to the import's endpoint, which acts as the signed-in user.
	import { tick } from 'svelte';
	import { invalidate } from '$app/navigation';
	import ArrowRightLeft from '@lucide/svelte/icons/arrow-right-left';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import Check from '@lucide/svelte/icons/check';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import FileSpreadsheet from '@lucide/svelte/icons/file-spreadsheet';
	import FolderOpen from '@lucide/svelte/icons/folder-open';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import Merge from '@lucide/svelte/icons/merge';
	import Minus from '@lucide/svelte/icons/minus';
	import PencilLine from '@lucide/svelte/icons/pencil-line';
	import Plus from '@lucide/svelte/icons/plus';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import Split from '@lucide/svelte/icons/split';
	import Upload from '@lucide/svelte/icons/upload';
	import Wand2 from '@lucide/svelte/icons/wand-2';
	import X from '@lucide/svelte/icons/x';
	import type { ChatEntry, RunProgress, Turn, WizardAction, WizardView } from './types';
	import { inlineRuns } from './inline';

	let {
		view,
		open: shown,
		openSlug,
		openRevision,
		onclose,
		onopen
	}: {
		view: WizardView;
		/** Whether the panel shows; a proposal's Accept and Reject stay on the board either way. */
		open: boolean;
		/** The process open on the board. */
		openSlug?: string;
		/** Its draft revision, which a publish is made against. */
		openRevision?: number;
		onclose: () => void;
		/** Opens a process of the import on the board. */
		onopen: (slug: string) => void;
	} = $props();

	const wiz = $derived(view.state);
	const open = $derived(wiz.processes.find((p) => p.slug === openSlug));
	const current = $derived(open ?? wiz.processes.find((p) => p.key === wiz.activeKey));
	let busy = $state<string | undefined>();
	let problem = $state<string | undefined>();
	let text = $state('');
	let renaming = $state<string | undefined>();
	let scroller = $state<HTMLElement>();
	/** The newest version of the import this panel saved, which can be ahead of the page data. */
	let saved = $state(0);
	const version = $derived(Math.max(view.version, saved));

	const turnOf = (id: string): Turn | undefined => wiz.turns.find((t) => t.id === id);
	const titleOf = (key: string) =>
		wiz.split?.processes.find((p) => p.key === key)?.title ??
		wiz.processes.find((p) => p.key === key)?.title ??
		key;
	const lastSplit = $derived(wiz.messages.findLast((m) => m.card?.type === 'split')?.id);
	const live = $derived(wiz.split?.processes.filter((p) => !p.mergedInto) ?? []);
	const lastPublish = $derived(
		wiz.messages.findLast((m) => m.card?.type === 'publish' && m.card.processKey === current?.key)
			?.card
	);

	/** What the server says the assistant is doing, while a turn runs. */
	let activity = $state<RunProgress | undefined>();
	/** The request that last failed, offered again with Retry. */
	let failed = $state<{ request: WizardAction; label: string } | undefined>();
	const AGENT: ReadonlySet<WizardAction['action']> = new Set(['split', 'reply', 'draft']);

	/** How often a running turn's progress is read: often enough that its writing reads as live. */
	const POLL_MS = 600;
	/** Items of a live proposal shown at once; the newest are kept. */
	const MAX_LIVE = 12;
	const KIND: Record<string, string> = {
		process: 'Process',
		shared: 'Shared',
		stage: 'Stage',
		role: 'Role',
		fact: 'Fact',
		step: 'Step',
		decision: 'Decision',
		approval: 'Approval',
		lookup: 'Lookup',
		change: 'Change'
	};

	/** Polls the import's progress until `done` settles. */
	async function watch(done: Promise<unknown>) {
		let settled = false;
		void done.finally(() => (settled = true));
		while (!settled) {
			try {
				const response = await fetch(`/wizard/${view.id}`, { signal: AbortSignal.timeout(10_000) });
				const body = (await response.json()) as { progress: RunProgress | null };
				if (!settled) activity = body.progress ?? activity;
			} catch {
				// A missed poll only delays the next update.
			}
			await Promise.race([done, new Promise((r) => setTimeout(r, POLL_MS))]).catch(() => undefined);
		}
		activity = undefined;
	}

	/** Sends a request; resolves the import's answer, or undefined after showing why it failed. */
	async function send(
		request: WizardAction,
		label: string
	): Promise<{ version: number; slug?: string } | undefined> {
		if (busy) return undefined;
		busy = label;
		problem = undefined;
		failed = undefined;
		activity = undefined;
		// The server stops a turn at its timeout from when it arrives, waiting included; give its
		// answer a minute more to arrive.
		const limit = (view.timeoutSeconds + 60) * 1000;
		const call = fetch(`/wizard/${view.id}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ ...request, version }),
			signal: AbortSignal.timeout(limit)
		});
		if (AGENT.has(request.action)) void watch(call);
		try {
			const response = await call;
			const result = await response.json();
			if (!result.ok) {
				problem = result.reason ?? 'That did not work';
				failed = { request, label };
				return undefined;
			}
			saved = result.version;
			await Promise.all([invalidate('casebook:board'), invalidate('casebook:shell')]);
			return result;
		} catch (error) {
			problem =
				error instanceof DOMException && error.name === 'TimeoutError'
					? `No answer from the server after ${Math.round(limit / 60_000)} minutes. Reload to see whether the assistant finished, or try again.`
					: `Could not reach the server: ${error instanceof Error ? error.message : String(error)}`;
			failed = { request, label };
			return undefined;
		} finally {
			busy = undefined;
		}
	}

	/** Sends the request that failed once more, against the import as it is now. */
	async function retry() {
		const again = failed;
		if (!again) return;
		await Promise.all([invalidate('casebook:board'), invalidate('casebook:shell')]);
		await send(again.request, again.label);
	}

	// A turn already running when the page opens, such as after a reload, is shown until it ends.
	let resumed = false;
	$effect(() => {
		if (resumed || !view.progress) return;
		resumed = true;
		busy = 'The assistant is working';
		const done = (async () => {
			for (;;) {
				await new Promise((r) => setTimeout(r, 2000));
				try {
					const body = (await (await fetch(`/wizard/${view.id}`)).json()) as {
						progress: RunProgress | null;
					};
					if (!body.progress) return;
				} catch {
					return;
				}
			}
		})();
		void watch(done);
		void done.then(async () => {
			busy = undefined;
			await Promise.all([invalidate('casebook:board'), invalidate('casebook:shell')]);
		});
	});

	const elapsed = (seconds: number) =>
		`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

	async function acceptSplit() {
		const result = await send({ action: 'accept-split' }, 'Creating the processes');
		if (!result?.slug) return;
		onopen(result.slug);
		await tick();
		const key = view.state.activeKey;
		if (key) await send({ action: 'draft', key }, `Drafting ${titleOf(key)}`);
	}

	async function reply(message = text) {
		const trimmed = message.trim();
		if (!trimmed) return;
		text = '';
		await send(
			{ action: 'reply', text: trimmed, ...(current ? { processKey: current.key } : {}) },
			'Thinking'
		);
	}

	async function draft(key: string, slug: string) {
		if (slug !== openSlug) onopen(slug);
		await send({ action: 'draft', key }, `Drafting ${titleOf(key)}`);
	}

	// The first split is asked for as soon as the import opens, unless it is already being made.
	let asked = false;
	$effect(() => {
		if (!asked && wiz.phase === 'split' && !wiz.split && !busy && !view.progress) {
			asked = true;
			void send({ action: 'split' }, 'Reading the spreadsheet');
		}
	});

	$effect(() => {
		void wiz.messages.length;
		void busy;
		tick().then(() => scroller?.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' }));
	});

	const quick = $derived.by(() => {
		const out: { label: string; run: () => void }[] = [];
		if (wiz.phase === 'split' && wiz.split) {
			out.push({ label: 'Looks good, accept the split', run: acceptSplit });
		}
		if (wiz.phase === 'draft') {
			if (lastPublish?.type === 'publish' && !lastPublish.ok && current) {
				out.push({ label: 'Ask the assistant to fix it', run: () => fix(lastPublish.problems) });
			}
			for (const p of wiz.processes) {
				const pending = wiz.turns.some((t) => t.processKey === p.key && t.status === 'pending');
				if (!p.drafted && !pending) {
					out.push({ label: `Draft ${p.title}`, run: () => draft(p.key, p.slug) });
				}
			}
		}
		return out.slice(0, 3);
	});

	function fix(problems: string[]) {
		void reply(
			`Publishing failed these checks:\n${problems.map((p) => `- ${p}`).join('\n')}\nPlease fix them.`
		);
	}

	const changeIcon = {
		added: Plus,
		changed: PencilLine,
		removed: Minus,
		reordered: ArrowRightLeft
	};
	const changeTone = {
		added: 'bg-emerald-50 text-emerald-700',
		changed: 'bg-amber-50 text-amber-700',
		removed: 'bg-red-50 text-red-700',
		reordered: 'bg-muted text-muted-foreground'
	};
	const MAX_CHANGES = 10;
	const small =
		'inline-flex h-7 cursor-pointer items-center gap-1 rounded-md px-2 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45';
</script>

{#snippet avatar()}
	<span
		class="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground text-background"
		><Sparkles class="size-3.5" /></span
	>
{/snippet}

{#snippet splitCard(interactive: boolean)}
	{#if wiz.split}
		<div class="mt-2 overflow-hidden rounded-xl border text-[12.5px]">
			{#each wiz.split.processes as p (p.key)}
				<div class="border-b px-3 py-2.5 last:border-b-0">
					{#if p.mergedInto}
						<p class="text-muted-foreground line-through">{p.title}</p>
						<p class="text-[11px] text-muted-foreground">Merged into {titleOf(p.mergedInto)}</p>
					{:else if renaming === p.key}
						<form
							class="flex gap-1.5"
							onsubmit={(e) => {
								e.preventDefault();
								const title = new FormData(e.currentTarget).get('title');
								renaming = undefined;
								void send({ action: 'rename', key: p.key, title: String(title) }, 'Renaming');
							}}
						>
							<!-- svelte-ignore a11y_autofocus -->
							<input
								name="title"
								value={p.title}
								aria-label="Process name"
								autofocus
								class="h-7 min-w-0 flex-1 rounded-md bg-muted/70 px-2 outline-none focus:ring-2 focus:ring-brand-ring"
							/>
							<button class="h-7 cursor-pointer rounded-md bg-foreground px-2 text-background"
								>Save</button
							>
							<button type="button" class={small} onclick={() => (renaming = undefined)}
								>Cancel</button
							>
						</form>
					{:else}
						<div class="flex items-start gap-2">
							<div class="min-w-0 flex-1">
								<p class="font-medium">{p.title}</p>
								{#each view.ranges[p.key] ?? [] as where (where)}
									<p class="text-[11px] text-muted-foreground">{where}</p>
								{/each}
								{#if p.suggestedTitle}<p class="text-[11px] text-muted-foreground">
										Suggested as “{p.suggestedTitle}”
									</p>{/if}
								<p class="mt-0.5 text-[11.5px] text-muted-foreground">{p.summary}</p>
							</div>
							{#if interactive}
								<div class="flex shrink-0 flex-col items-end">
									<button class={small} disabled={!!busy} onclick={() => (renaming = p.key)}
										><PencilLine class="size-3" />Rename</button
									>
									{#if live.length > 1}
										<label class={[small, 'relative']}>
											<Merge class="size-3" />Merge into
											<select
												class="absolute inset-0 cursor-pointer opacity-0"
												aria-label="Merge {p.title} into"
												disabled={!!busy}
												onchange={(e) => {
													const into = e.currentTarget.value;
													if (into) void send({ action: 'merge', from: p.key, into }, 'Merging');
												}}
											>
												<option value="">Merge into…</option>
												{#each live.filter((o) => o.key !== p.key) as other (other.key)}
													<option value={other.key}>{other.title}</option>
												{/each}
											</select>
										</label>
									{/if}
									{#if p.sources.length > 1}
										<label class={[small, 'relative']}>
											<Split class="size-3" />Split
											<select
												class="absolute inset-0 cursor-pointer opacity-0"
												aria-label="Split cells off {p.title}"
												disabled={!!busy}
												onchange={(e) => {
													const index = Number(e.currentTarget.value);
													if (e.currentTarget.value !== '') {
														void send({ action: 'split-off', key: p.key, index }, 'Splitting');
													}
												}}
											>
												<option value="">Split off…</option>
												{#each view.ranges[p.key] ?? [] as where, i (i)}
													<option value={i}>{where}</option>
												{/each}
											</select>
										</label>
									{/if}
								</div>
							{/if}
						</div>
					{/if}
				</div>
			{/each}
			{#each wiz.split.shared as s, i (i)}
				<div class="flex items-start gap-2 border-b bg-muted/30 px-3 py-2.5 last:border-b-0">
					<FolderOpen class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
					<div class="min-w-0">
						<p class="font-medium">{s.title}</p>
						{#each view.ranges[`shared:${i}`] ?? [] as where (where)}
							<p class="text-[11px] text-muted-foreground">{where}</p>
						{/each}
						<p class="text-[11px] text-muted-foreground">Shared: every process can draw on it</p>
					</div>
				</div>
			{/each}
			<div class="flex items-center justify-end gap-2 px-3 py-2">
				{#if wiz.phase === 'draft'}
					<span class="inline-flex items-center gap-1 text-[11.5px] text-muted-foreground"
						><Check class="size-3.5" />Split accepted: {wiz.processes.length}
						{wiz.processes.length === 1 ? 'process' : 'processes'}</span
					>
				{:else if interactive}
					<span class="mr-auto text-[11px] text-muted-foreground"
						>Creates {live.length} {live.length === 1 ? 'process' : 'processes'}</span
					>
					<button
						class="h-8 cursor-pointer rounded-lg bg-foreground px-3 font-medium text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
						disabled={!!busy}
						onclick={acceptSplit}>Accept split</button
					>
				{:else}
					<span class="text-[11px] text-muted-foreground">An earlier proposal</span>
				{/if}
			</div>
		</div>
	{/if}
{/snippet}

{#snippet turnCard(turn: Turn)}
	{@const process = wiz.processes.find((p) => p.key === turn.processKey)}
	{@const preview = view.preview?.turnId === turn.id ? view.preview : undefined}
	<div class="mt-2 overflow-hidden rounded-xl border text-[12.5px]">
		{#if turn.status === 'pending' && preview?.ok}
			<ul class="flex flex-col">
				{#each preview.changes.slice(0, MAX_CHANGES) as change, i (i)}
					{@const Icon = changeIcon[change.kind]}
					<li class="flex items-start gap-2 border-b px-3 py-1.5">
						<span
							class={[
								'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded',
								changeTone[change.kind]
							]}><Icon class="size-3" /></span
						>
						<span class="min-w-0">{change.summary}</span>
					</li>
				{/each}
				{#if preview.changes.length > MAX_CHANGES}
					<li class="border-b px-3 py-1.5 text-muted-foreground">
						and {preview.changes.length - MAX_CHANGES} more on the board
					</li>
				{/if}
			</ul>
			{#if preview.blocking.length}
				<p
					class="flex items-start gap-1.5 border-b bg-amber-50/60 px-3 py-2 text-[11.5px] text-amber-900"
				>
					<CircleAlert class="mt-0.5 size-3 shrink-0" />Publishing would still be blocked: {preview
						.blocking[0]}{preview.blocking.length > 1
						? ` (and ${preview.blocking.length - 1} more)`
						: ''}
				</p>
			{/if}
			<div class="flex items-center gap-2 px-3 py-2">
				<span class="mr-auto text-[11px] text-muted-foreground">Shown on the board</span>
				<button
					class="inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg border px-2.5 hover:bg-muted disabled:opacity-45"
					disabled={!!busy}
					onclick={() => send({ action: 'reject', turnId: turn.id }, 'Rejecting')}
					><X class="size-3.5" />Reject</button
				>
				<button
					class="inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg bg-foreground px-2.5 font-medium text-background hover:opacity-90 disabled:opacity-45"
					disabled={!!busy}
					onclick={() =>
						send({ action: 'accept', turnId: turn.id, baseRevision: preview.revision }, 'Saving')}
					><Check class="size-3.5" />Accept</button
				>
			</div>
		{:else if turn.status === 'pending' && preview && !preview.ok}
			<p class="flex items-start gap-1.5 px-3 py-2 text-[12px]">
				<CircleAlert class="mt-0.5 size-3.5 shrink-0 text-destructive" />{preview.reason}
			</p>
			<div class="flex justify-end border-t px-3 py-2">
				<button
					class="inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg border px-2.5 hover:bg-muted"
					disabled={!!busy}
					onclick={() => send({ action: 'reject', turnId: turn.id }, 'Rejecting')}
					><X class="size-3.5" />Reject</button
				>
			</div>
		{:else if turn.status === 'pending'}
			<div class="flex items-center gap-2 px-3 py-2">
				<span class="mr-auto text-muted-foreground"
					>{turn.ops.length} changes to {process?.title} waiting for you</span
				>
				{#if process}<button
						class="h-8 cursor-pointer rounded-lg border px-2.5 hover:bg-muted"
						onclick={() => onopen(process.slug)}>Review</button
					>{/if}
			</div>
		{:else}
			{#if turn.changes?.length}
				<ul class="flex flex-col gap-0.5 border-b px-3 py-2 text-[11.5px] text-muted-foreground">
					{#each turn.changes.slice(0, 4) as change, i (i)}<li>{change}</li>{/each}
					{#if turn.changes.length > 4}<li>and {turn.changes.length - 4} more</li>{/if}
				</ul>
			{/if}
			<p class="flex items-center gap-1.5 px-3 py-2 text-[11.5px] text-muted-foreground">
				{#if turn.status === 'accepted'}<Check class="size-3.5 text-emerald-600" />Accepted
				{:else if turn.status === 'rejected'}<X class="size-3.5" />Rejected
				{:else}<ArrowRightLeft class="size-3.5" />Replaced by a later proposal{/if}
			</p>
		{/if}
	</div>
{/snippet}

{#snippet entry(m: ChatEntry)}
	{#if m.role === 'user'}
		<div class="ml-10 self-end rounded-2xl bg-muted px-3.5 py-2 text-[13px] whitespace-pre-line">
			{m.text}
		</div>
	{:else if m.role === 'note'}
		{#if m.card?.type === 'publish'}
			{@const card = m.card}
			<div
				class={[
					'rounded-xl border text-[12.5px]',
					card.ok ? 'border-emerald-200 bg-emerald-50/50' : 'border-amber-300 bg-amber-50/60'
				]}
			>
				<p class="flex items-start gap-1.5 px-3 py-2 font-medium">
					{#if card.ok}<CircleCheck
							class="mt-0.5 size-3.5 shrink-0 text-emerald-600"
						/>{:else}<CircleAlert class="mt-0.5 size-3.5 shrink-0 text-amber-700" />{/if}{m.text}
				</p>
				{#if card.problems.length}
					<ul class="flex flex-col gap-1 border-t px-3 py-2 text-[11.5px]">
						{#each card.problems as p, i (i)}<li class="flex gap-1.5">
								<CircleAlert class="mt-0.5 size-3 shrink-0 text-destructive" />{p}
							</li>{/each}
					</ul>
					<div class="flex justify-end border-t px-3 py-2">
						<button
							class="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border bg-background px-2.5 hover:bg-muted disabled:opacity-45"
							disabled={!!busy}
							onclick={() => fix(card.problems)}
							><Wand2 class="size-3.5" />Ask the assistant to fix it</button
						>
					</div>
				{/if}
			</div>
		{:else}
			<p
				class="flex items-center justify-center gap-1.5 text-center text-[11.5px] text-muted-foreground"
			>
				<Check class="size-3 shrink-0" />{m.text}
			</p>
		{/if}
	{:else}
		<div class="flex gap-2.5">
			{@render avatar()}
			<div class="min-w-0 flex-1 text-[13px] leading-relaxed">
				<p class="whitespace-pre-line">
					{#each inlineRuns(m.text) as run, i (i)}{#if run.style === 'bold'}<b class="font-semibold"
								>{run.text}</b
							>{:else if run.style === 'code'}<code
								class="rounded bg-muted px-1 py-px font-mono text-[11.5px]">{run.text}</code
							>{:else}{run.text}{/if}{/each}
				</p>
				{#if m.card?.type === 'upload'}
					<p
						class="mt-2 inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] text-muted-foreground"
					>
						<FileSpreadsheet class="size-3.5" />{view.fileName}
					</p>
				{:else if m.card?.type === 'split'}
					{@render splitCard(m.id === lastSplit && wiz.phase === 'split')}
				{:else if m.card?.type === 'turn'}
					{@const turn = turnOf(m.card.turnId)}
					{#if turn}{@render turnCard(turn)}{/if}
				{/if}
			</div>
		</div>
	{/if}
{/snippet}

{#if view.preview?.ok}
	{@const preview = view.preview}
	<div
		class={[
			'pointer-events-none absolute bottom-4 left-0 z-30 flex justify-center',
			shown ? 'right-[404px]' : 'right-0'
		]}
	>
		<div
			class="pointer-events-auto flex items-center gap-2 rounded-2xl border bg-background py-1.5 pr-1.5 pl-4 text-[12.5px] shadow-lg"
			role="region"
			aria-label="Proposal from the assistant"
		>
			<span
				>{preview.changes.length}
				{preview.changes.length === 1 ? 'change' : 'changes'} from the assistant</span
			>
			<button
				class="inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg border px-2.5 hover:bg-muted disabled:opacity-45"
				disabled={!!busy}
				onclick={() => send({ action: 'reject', turnId: preview.turnId }, 'Rejecting')}
				><X class="size-3.5" />Reject</button
			>
			<button
				class="inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg bg-foreground px-2.5 font-medium text-background hover:opacity-90 disabled:opacity-45"
				disabled={!!busy}
				onclick={() =>
					send(
						{ action: 'accept', turnId: preview.turnId, baseRevision: preview.revision },
						'Saving'
					)}><Check class="size-3.5" />Accept</button
			>
		</div>
	</div>
{/if}

<aside
	class={[
		'absolute top-3 right-3 bottom-3 z-30 flex w-[392px] max-w-[calc(100%-24px)] flex-col overflow-hidden rounded-2xl border bg-background shadow-xl',
		!shown && 'hidden'
	]}
	aria-label="Assistant"
>
	<header class="flex h-12 shrink-0 items-center gap-2 border-b px-4">
		<Sparkles class="size-4" />
		<h2 class="text-[13.5px] font-semibold">Assistant</h2>
		<span class="truncate text-[11px] text-muted-foreground" title="The chat model it runs on"
			>{view.model}</span
		>
		<button
			class="ml-auto flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
			aria-label="Close the assistant"
			onclick={onclose}><X class="size-4" /></button
		>
	</header>
	{#if wiz.phase === 'draft' && current}
		<div class="flex shrink-0 items-center gap-2 border-b bg-muted/30 px-4 py-2 text-[12px]">
			<span class="min-w-0 flex-1 truncate"
				>{current.slug === openSlug ? 'Drafting' : 'Last drafted'}
				<b class="font-medium">{current.title}</b></span
			>
			{#if current.slug === openSlug}
				<button
					class="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md bg-brand px-2 font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
					disabled={!!busy || openRevision === undefined}
					title="Publish the saved draft; the publish checks run first"
					onclick={() =>
						send(
							{ action: 'publish', key: current.key, baseRevision: openRevision ?? 0 },
							'Publishing'
						)}><Upload class="size-3.5" />Publish</button
				>
			{:else}
				<button class={small} onclick={() => onopen(current.slug)}>Open</button>
			{/if}
		</div>
	{/if}
	<div
		bind:this={scroller}
		class="no-scrollbar flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4"
	>
		{#each wiz.messages as m (m.id)}{@render entry(m)}{/each}
		{#if busy}
			<div class="flex gap-2.5">
				{@render avatar()}
				<div class="min-w-0 flex-1 text-[13px]">
					{#if activity?.text}
						<p class="mb-1.5 leading-relaxed whitespace-pre-line">{activity.text}</p>
					{/if}
					{#if activity?.items.length}
						{@const shown = activity.items.slice(-MAX_LIVE)}
						<ul
							class="mb-2 flex flex-col overflow-hidden rounded-xl border text-[12px]"
							aria-label="What the assistant is proposing so far"
						>
							{#if activity.items.length > shown.length}
								<li class="border-b px-3 py-1 text-[11px] text-muted-foreground">
									and {activity.items.length - shown.length} before these
								</li>
							{/if}
							{#each shown as item, i (i)}
								<li class="flex items-baseline gap-2 border-b px-3 py-1 last:border-b-0">
									<span class="w-16 shrink-0 text-[11px] text-muted-foreground"
										>{KIND[item.kind] ?? item.kind}</span
									>
									<span class="min-w-0 truncate">{item.title}</span>
								</li>
							{/each}
						</ul>
					{/if}
					<p class="flex items-center gap-2 text-muted-foreground" role="status">
						<LoaderCircle class="size-3.5 shrink-0 animate-spin" />{activity?.activity ??
							busy}…{#if activity}<span class="ml-auto shrink-0 text-[11px] tabular-nums"
								>{elapsed(activity.seconds)}</span
							>{/if}
					</p>
					{#if activity?.waiting && activity.seconds >= 20}
						<p class="mt-1 text-[11.5px] text-muted-foreground">
							It starts as soon as the model is free.
						</p>
					{:else if activity && activity.seconds >= 90}
						<p class="mt-1 text-[11.5px] text-muted-foreground">
							Still working. It stops after {Math.round(view.timeoutSeconds / 60)} minutes if it gets
							stuck.
						</p>
					{/if}
				</div>
			</div>
		{/if}
		{#if problem}
			<div
				role="alert"
				class="flex items-start gap-2 rounded-xl border border-destructive/40 px-3 py-2 text-[12.5px]"
			>
				<CircleAlert class="mt-0.5 size-3.5 shrink-0 text-destructive" />
				<p class="min-w-0 flex-1">{problem}</p>
				{#if failed}
					<button
						class="shrink-0 cursor-pointer font-medium text-brand disabled:opacity-45"
						disabled={!!busy}
						onclick={retry}>Retry</button
					>
				{/if}
			</div>
		{/if}
	</div>
	<footer class="shrink-0 border-t p-3">
		{#if quick.length}
			<div class="mb-2 flex flex-wrap gap-1.5">
				{#each quick as q (q.label)}
					<button
						class="cursor-pointer rounded-full border px-2.5 py-1 text-[11.5px] hover:bg-muted disabled:opacity-45"
						disabled={!!busy}
						onclick={q.run}>{q.label}</button
					>
				{/each}
			</div>
		{/if}
		<form
			class="flex items-end gap-2 rounded-xl border px-3 py-2 focus-within:ring-2 focus-within:ring-brand-ring"
			onsubmit={(e) => {
				e.preventDefault();
				void reply();
			}}
		>
			<textarea
				bind:value={text}
				rows="1"
				placeholder={wiz.phase === 'split' ? 'Ask for a different split' : 'Reply to the assistant'}
				aria-label="Message the assistant"
				class="max-h-32 min-h-6 flex-1 resize-none bg-transparent text-[13px] outline-none"
				onkeydown={(e) => {
					if (e.key === 'Enter' && !e.shiftKey) {
						e.preventDefault();
						void reply();
					}
				}}></textarea>
			<button
				class="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-foreground text-background disabled:cursor-not-allowed disabled:opacity-30"
				aria-label="Send"
				disabled={!!busy || !text.trim()}><ArrowUp class="size-4" /></button
			>
		</form>
	</footer>
</aside>
