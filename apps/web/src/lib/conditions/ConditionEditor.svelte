<script lang="ts">
	// One condition of a step or decision: "Only when" or "Stops repeating when". Read as one plain
	// line; opened, it is built from rules (fact, operator, value) or typed as code, and tested with
	// sample values. Nothing changes until Save, which is one edit of the definition. The words
	// people see follow the rules unless someone wrote their own.
	import { tick, type Component } from 'svelte';
	import { page } from '$app/state';
	import {
		fromCondition,
		guardReferences,
		toCondition,
		type Group,
		type Guard
	} from '@casebook/model';
	import Code from '@lucide/svelte/icons/code';
	import FlaskConical from '@lucide/svelte/icons/flask-conical';
	import ListFilter from '@lucide/svelte/icons/list-filter';
	import Pencil from '@lucide/svelte/icons/pencil';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import X from '@lucide/svelte/icons/x';
	import type { ProcessIndex } from '$lib/graph/derive';
	import CodeEditor from './CodeEditor.svelte';
	import { checkCode, describe, factInfo, factOptions, type FactTiming } from './conditions';
	import GroupEditor from './GroupEditor.svelte';
	import { widen } from './layout.svelte';
	import { samplesFor } from './samples.svelte';
	import TestPanel from './TestPanel.svelte';

	let {
		ix,
		guard,
		label,
		icon: Icon,
		lead,
		outcome,
		onsave,
		onremove,
		oncancel,
		removeLabel,
		open = false,
		publishes = false,
		timing
	}: {
		ix: ProcessIndex;
		/** The saved condition; a new one not saved yet has empty text and no expression. */
		guard: Guard;
		/** "Only when" or "Stops repeating when". */
		label: string;
		icon: Component<{ class?: string }>;
		/** How the words people see begin, such as "Only when"; the rules follow it. */
		lead: string;
		/** What each test answer means, such as "this step runs". */
		outcome: { true: string; false: string; unknown: string };
		/** Saves the condition, or is absent when it cannot be edited. */
		onsave?: (guard: Guard, label: string) => Promise<boolean>;
		onremove?: () => void;
		/** For a condition not saved yet: Cancel drops it. */
		oncancel?: () => void;
		removeLabel: string;
		/** Starts open for editing, as when it was just added. */
		open?: boolean;
		/** True when saving publishes at once, as in a living process. */
		publishes?: boolean;
		/** When each fact is recorded, seen from this step, to warn about rules that never hold. */
		timing?: Map<string, FactTiming>;
	} = $props();

	const samples = $derived(
		samplesFor(page.params.instance ?? '', ix.document.slug, page.data.timeZone)
	);
	const people = $derived(samples.context?.people);
	const options = $derived(factOptions(ix));
	const summary = $derived(describe(ix, guard.expr, people));
	const broken = $derived(guard.expr ? checkCode(ix, guard.expr) : undefined);
	const isNew = $derived(!guard.text && !guard.expr);
	/** Words that only restate the rules, or the placeholder older conditions started with. */
	const autoWords = (g: Guard) => {
		const said = describe(ix, g.expr, people);
		return (
			!g.text ||
			(said !== undefined && g.text === `${lead} ${said}`) ||
			/^Only when .* is needed$/.test(g.text) ||
			g.text === 'Until it is no longer needed'
		);
	};
	/** The prose without the lead the label already says: "Only when / the bill is paid". */
	const prose = (text: string) =>
		text.toLowerCase().startsWith(`${lead.toLowerCase()} `) ? text.slice(lead.length + 1) : text;

	let box = $state<HTMLElement>();
	let editing = $state(false);
	let testing = $state(false);
	let mode = $state<'rules' | 'code'>('rules');
	let rules = $state<Group>({ kind: 'group', join: 'all', items: [] });
	let code = $state('');
	let words = $state('');
	let wordsTouched = $state(false);
	let rewording = $state(false);
	let notice = $state<string | undefined>();
	let saving = $state(false);

	const draft = $derived(mode === 'rules' ? fromCondition(rules) : code.trim() || undefined);
	const draftProblem = $derived(draft ? checkCode(ix, draft) : undefined);
	// While the code is broken, the words keep the last wording that worked.
	let lastGood = $state('');
	$effect(() => {
		if (draft && !draftProblem) lastGood = `${lead} ${describe(ix, draft, people) ?? ''}`;
	});
	const draftWords = $derived(
		wordsTouched || !autoWords(guard) ? words : draft ? lastGood || guard.text : guard.text
	);
	const dirty = $derived(draft !== guard.expr || draftWords.trim() !== guard.text);
	const canSave = $derived(dirty && !draftProblem && !saving && (!!draft || !!draftWords.trim()));
	const unfinished = $derived(
		mode === 'rules' &&
			rules.items.some(function unset(i): boolean {
				return i.kind === 'group' ? i.items.some(unset) : !fromCondition(i);
			})
	);
	/** Facts the rules read that are never recorded before this step can start. */
	const late = $derived(
		draft && !draftProblem && timing
			? guardReferences(draft).facts.flatMap((f) => {
					const when = timing.get(f);
					return when && when !== 'before' ? [{ name: factInfo(ix)(f).name, when }] : [];
				})
			: []
	);

	$effect(() => (editing || testing ? widen() : undefined));
	$effect(() => {
		if (
			guard.expr &&
			guardReferences(guard.expr).facts.some((f) => factInfo(ix)(f).kind === 'people')
		)
			samples.load();
	});

	async function reveal() {
		await tick();
		box?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
	}
	function startEditing() {
		const read = guard.expr ? toCondition(guard.expr) : undefined;
		mode = guard.expr && !read ? 'code' : 'rules';
		rules = read ?? { kind: 'group', join: 'all', items: [{ kind: 'rule', fact: '', op: 'is' }] };
		code = guard.expr ?? '';
		words = guard.text;
		wordsTouched = false;
		rewording = false;
		notice = undefined;
		editing = true;
		reveal();
	}
	function cancel() {
		editing = false;
		oncancel?.();
	}
	function switchTo(next: 'rules' | 'code') {
		if (next === mode) return;
		notice = undefined;
		if (next === 'code') {
			code = draft ?? '';
		} else {
			const read = code.trim()
				? toCondition(code)
				: { kind: 'group' as const, join: 'all' as const, items: [] };
			if (!read) {
				notice =
					'This code uses something the rules cannot show, such as “not” around a group or two facts compared, so it stays as code.';
				return;
			}
			rules = read.items.length ? read : { ...read, items: [{ kind: 'rule', fact: '', op: 'is' }] };
		}
		mode = next;
	}
	async function save() {
		if (!onsave || !canSave) return;
		saving = true;
		const text = draftWords.trim() || `${lead} ${describe(ix, draft, people) ?? ''}`;
		const ok = await onsave(
			draft ? { text, expr: draft } : { text },
			`${isNew ? 'Added' : 'Changed'}: ${label.toLowerCase()}`
		);
		saving = false;
		if (ok) editing = false;
	}

	// A condition just added opens to build its rules.
	// svelte-ignore state_referenced_locally
	if (open && onsave) startEditing();
	const quiet =
		'inline-flex h-7 cursor-pointer items-center gap-1 rounded-md px-1.5 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground';
</script>

<div class="flex items-start gap-2" bind:this={box}>
	<Icon class="mt-1 size-3.5 shrink-0 text-muted-foreground" />
	<div class="flex min-w-0 flex-1 flex-col gap-2">
		<div class="flex items-center gap-1">
			<span class="text-[12px] text-muted-foreground">{label}</span>
			<span class="ml-auto flex items-center">
				{#if guard.expr && !broken && !editing}
					<button
						type="button"
						class={[quiet, testing && 'bg-muted text-foreground']}
						aria-expanded={testing}
						onclick={() => {
							testing = !testing;
							if (testing) reveal();
						}}><FlaskConical class="size-3.5" />Test</button
					>
				{/if}
				{#if onsave && !editing}
					<button type="button" class={quiet} onclick={startEditing}
						><Pencil class="size-3.5" />Edit</button
					>
				{/if}
				{#if onremove && !editing}
					<button
						type="button"
						class="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-destructive"
						aria-label={removeLabel}
						onclick={onremove}><X class="size-3.5" /></button
					>
				{/if}
			</span>
		</div>

		{#if !editing}
			{#if guard.expr && summary && !broken}
				<p class="text-[13px] leading-snug font-medium">{summary}</p>
				{#if !autoWords(guard)}
					<p class="text-[11.5px] text-muted-foreground">People see “{guard.text}”</p>
				{/if}
			{:else if guard.expr}
				<p class="text-[13px] leading-snug">{prose(guard.text)}</p>
				<p class="flex items-start gap-1.5 text-[11.5px] text-amber-700 dark:text-amber-400">
					<TriangleAlert class="mt-0.5 size-3.5 shrink-0" />The code for this condition does not
					work{broken ? `: ${broken.message.replace(/\.$/, '')}` : ''}. People decide it by hand
					until it is fixed.
				</p>
			{:else}
				<p class="text-[13px] leading-snug">{prose(guard.text)}</p>
				<p class="text-[11.5px] text-muted-foreground">
					In words only, so people decide it each time.{onsave
						? ' Add rules to decide it for them.'
						: ''}
				</p>
			{/if}
			{#if testing && guard.expr && !broken}
				<TestPanel {ix} expr={guard.expr} {outcome} />
			{/if}
		{:else}
			<div class="flex flex-col gap-3 rounded-xl border p-3">
				<div class="flex items-center gap-2">
					<div
						role="radiogroup"
						aria-label="Build it with"
						class="inline-flex gap-0.5 rounded-lg bg-muted p-0.5"
					>
						{#each [{ v: 'rules', l: 'Rules', i: ListFilter }, { v: 'code', l: 'Code', i: Code }] as o (o.v)}
							<button
								type="button"
								role="radio"
								aria-checked={mode === o.v}
								class={[
									'inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-[12.5px]',
									mode === o.v
										? 'bg-background font-medium shadow-xs'
										: 'text-muted-foreground hover:text-foreground'
								]}
								onclick={() => switchTo(o.v as 'rules' | 'code')}
								><o.i class="size-3.5" />{o.l}</button
							>
						{/each}
					</div>
					<button
						type="button"
						class={['ml-auto', quiet, testing && 'bg-muted text-foreground']}
						aria-expanded={testing}
						onclick={() => (testing = !testing)}><FlaskConical class="size-3.5" />Test</button
					>
				</div>
				{#if notice}<p class="text-[12px] text-amber-700 dark:text-amber-400">{notice}</p>{/if}

				{#if mode === 'rules'}
					<GroupEditor bind:group={rules} {ix} {options} {timing} {people} />
				{:else}
					<CodeEditor {ix} bind:value={code} label="{label}, as code" />
				{/if}

				{#each late as l (l.name)}
					<p class="flex items-start gap-1.5 text-[12px] text-amber-700 dark:text-amber-400">
						<TriangleAlert class="mt-0.5 size-3.5 shrink-0" />{l.when === 'self'
							? `${l.name} is recorded by this step itself, so this would wait forever.`
							: l.when === 'later'
								? `${l.name} is only recorded later in the process, so this waits until then.`
								: `Nothing in this process records ${l.name}, so this would wait forever.`}
					</p>
				{/each}

				{#if testing}
					{#if draft && !draftProblem}
						<TestPanel {ix} expr={draft} {outcome} />
					{:else}
						<p class="text-[12px] text-muted-foreground">Finish a rule to test it.</p>
					{/if}
				{/if}

				{#if rewording || !autoWords(guard)}
					<label class="flex flex-col gap-1.5">
						<span class="flex items-center gap-2 text-[12px] text-muted-foreground"
							>What people see
							{#if draft && !draftProblem && draftWords !== lastGood}
								<button
									type="button"
									class="ml-auto cursor-pointer text-brand hover:underline"
									onclick={() => {
										words = lastGood;
										wordsTouched = true;
									}}>Use the rules’ wording</button
								>
							{/if}</span
						>
						<textarea
							rows="2"
							class="w-full resize-y rounded-lg bg-muted/70 px-3 py-2 text-[13px] leading-snug outline-none focus:bg-background focus:ring-2 focus:ring-brand-ring"
							value={draftWords}
							oninput={(e) => {
								words = e.currentTarget.value;
								wordsTouched = true;
							}}
							onkeydown={(e) => e.stopPropagation()}></textarea>
					</label>
				{:else if draft && !draftProblem}
					<p class="text-[12.5px]">
						<span class="text-muted-foreground">People see</span>
						“{draftWords}”
						<button
							type="button"
							class="ml-1 cursor-pointer text-[12px] text-brand hover:underline"
							onclick={() => {
								words = draftWords;
								rewording = true;
							}}>Change wording</button
						>
					</p>
				{/if}

				<div class="flex flex-wrap items-center gap-2">
					<button
						type="button"
						class="inline-flex h-8 cursor-pointer items-center rounded-lg bg-brand px-3 text-[12.5px] font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
						disabled={!canSave}
						onclick={save}
						>{saving ? 'Saving…' : publishes ? 'Save and publish' : 'Save to draft'}</button
					>
					<button
						type="button"
						class="inline-flex h-8 cursor-pointer items-center rounded-lg border px-3 text-[12.5px] hover:bg-muted"
						onclick={cancel}>Cancel</button
					>
					{#if draftProblem}
						<span class="text-[11.5px] text-destructive">Fix the code before saving.</span>
					{:else if unfinished}
						<span class="text-[11.5px] text-muted-foreground"
							>Rules without a fact or value are left out.</span
						>
					{:else if !draft}
						<span class="text-[11.5px] text-muted-foreground"
							>With no rules, people decide it each time.</span
						>
					{:else if publishes}
						<span class="text-[11.5px] text-muted-foreground"
							>This process is living: cases use it as soon as it is saved.</span
						>
					{/if}
				</div>
			</div>
		{/if}
	</div>
</div>
