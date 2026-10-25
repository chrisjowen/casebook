<script lang="ts">
	// One condition of a step or decision: "Only when" or "Repeats until". Read as one plain line;
	// opened, it is built from rules (fact, operator, value) or typed as code, and tested with sample
	// values. Saving changes the draft once; the words people see follow the rules unless someone
	// wrote their own.
	import type { Component } from 'svelte';
	import { fromCondition, toCondition, type Group, type Guard } from '@casebook/model';
	import { Code, FlaskConical, ListFilter, Pencil, TriangleAlert, X } from '@lucide/svelte';
	import type { ProcessIndex } from '$lib/graph/derive';
	import CodeEditor from './CodeEditor.svelte';
	import { checkCode, describe, factOptions } from './conditions';
	import GroupEditor from './GroupEditor.svelte';
	import { widen } from './layout.svelte';
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
		removeLabel,
		open = false
	}: {
		ix: ProcessIndex;
		guard: Guard;
		/** "Only when" or "Repeats until". */
		label: string;
		icon: Component<{ class?: string }>;
		/** How the words people see begin, such as "Only when"; the rules follow it. */
		lead: string;
		/** What each test answer means, such as "This step runs". */
		outcome: { true: string; false: string; unknown: string };
		/** Saves the condition, or is absent when it cannot be edited. */
		onsave?: (guard: Guard, label: string) => Promise<boolean>;
		onremove?: () => void;
		removeLabel: string;
		/** Starts open for editing, as when it was just added. */
		open?: boolean;
	} = $props();

	const options = $derived(factOptions(ix));
	const summary = $derived(describe(ix, guard.expr));
	const broken = $derived(guard.expr ? checkCode(ix, guard.expr) : undefined);
	/** Words that only restate the rules, or the placeholder a new condition starts with. */
	const autoWords = (g: Guard) => {
		const said = describe(ix, g.expr);
		return (
			(said !== undefined && g.text === `${lead} ${said}`) ||
			/^Only when .* is needed$/.test(g.text) ||
			g.text === 'Until it is no longer needed'
		);
	};

	let editing = $state(false);
	let testing = $state(false);
	let mode = $state<'rules' | 'code'>('rules');
	let rules = $state<Group>({ kind: 'group', join: 'all', items: [] });
	let code = $state('');
	let words = $state('');
	let wordsTouched = $state(false);
	let notice = $state<string | undefined>();
	let saving = $state(false);

	const draft = $derived(mode === 'rules' ? fromCondition(rules) : code.trim() || undefined);
	const draftProblem = $derived(draft ? checkCode(ix, draft) : undefined);
	const ruleWords = $derived(draft ? `${lead} ${describe(ix, draft) ?? ''}` : '');
	const draftWords = $derived(
		wordsTouched || !autoWords(guard) ? words : draft ? ruleWords : guard.text
	);
	const dirty = $derived(draft !== guard.expr || draftWords.trim() !== guard.text);
	const unfinished = $derived(
		mode === 'rules' &&
			rules.items.some(function unset(i): boolean {
				return i.kind === 'group' ? i.items.some(unset) : !fromCondition(i);
			})
	);

	$effect(() => (editing || testing ? widen() : undefined));

	function startEditing() {
		const read = guard.expr ? toCondition(guard.expr) : undefined;
		mode = guard.expr && !read ? 'code' : 'rules';
		rules = read ?? { kind: 'group', join: 'all', items: [{ kind: 'rule', fact: '', op: 'is' }] };
		code = guard.expr ?? '';
		words = guard.text;
		wordsTouched = false;
		notice = undefined;
		editing = true;
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
				notice = 'This code has parts the rules cannot show, so it stays as code.';
				return;
			}
			rules = read.items.length ? read : { ...read, items: [{ kind: 'rule', fact: '', op: 'is' }] };
		}
		mode = next;
	}
	async function save() {
		if (!onsave || draftProblem) return;
		saving = true;
		const text = draftWords.trim() || guard.text;
		const ok = await onsave(
			draft ? { text, expr: draft } : { text },
			`Changed: ${label.toLowerCase()}`
		);
		saving = false;
		if (ok) editing = false;
	}

	// A condition just added has no rules yet: it opens to build them.
	// svelte-ignore state_referenced_locally
	if (open && onsave) startEditing();
	const quiet =
		'inline-flex h-7 cursor-pointer items-center gap-1 rounded-md px-1.5 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground';
</script>

<div class="flex items-start gap-2">
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
						onclick={() => (testing = !testing)}><FlaskConical class="size-3.5" />Test</button
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
					<p class="text-[11.5px] text-muted-foreground">Shown to people as “{guard.text}”</p>
				{/if}
			{:else if guard.expr}
				<p class="text-[13px] leading-snug">{guard.text}</p>
				<p class="flex items-start gap-1.5 text-[11.5px] text-amber-700 dark:text-amber-400">
					<TriangleAlert class="mt-0.5 size-3.5 shrink-0" />The code for this condition does not
					work{broken ? `: ${broken.message.replace(/\.$/, '')}` : ''}. People decide it by hand
					until it is fixed.
				</p>
			{:else}
				<p class="text-[13px] leading-snug">{guard.text}</p>
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
					<GroupEditor bind:group={rules} {ix} {options} />
				{:else}
					<CodeEditor {ix} bind:value={code} label="{label}, as code" />
				{/if}

				{#if draft && !draftProblem}
					<p class="rounded-lg bg-muted/60 px-2.5 py-2 text-[12.5px]">
						<span class="text-muted-foreground">Reads as:</span>
						{describe(ix, draft)}
					</p>
				{/if}
				{#if testing}
					{#if draft && !draftProblem}
						<TestPanel {ix} expr={draft} {outcome} />
					{:else}
						<p class="text-[12px] text-muted-foreground">Finish a rule to test it.</p>
					{/if}
				{/if}

				<label class="flex flex-col gap-1.5">
					<span class="flex items-center gap-2 text-[12px] text-muted-foreground"
						>Shown to people as
						{#if draft && draft !== guard.expr && draftWords !== ruleWords}
							<button
								type="button"
								class="ml-auto cursor-pointer text-brand hover:underline"
								onclick={() => {
									words = ruleWords;
									wordsTouched = true;
								}}>Use the rules’ wording</button
							>
						{/if}</span
					>
					<input
						type="text"
						class="h-9 w-full rounded-lg bg-muted/70 px-3 text-[13px] outline-none focus:bg-background focus:ring-2 focus:ring-brand-ring"
						value={draftWords}
						oninput={(e) => {
							words = e.currentTarget.value;
							wordsTouched = true;
						}}
						onkeydown={(e) => e.stopPropagation()}
					/>
				</label>

				<div class="flex flex-wrap items-center gap-2">
					<button
						type="button"
						class="inline-flex h-8 cursor-pointer items-center rounded-lg bg-brand px-3 text-[12.5px] font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
						disabled={!dirty || !!draftProblem || saving}
						onclick={save}>{saving ? 'Saving…' : 'Save'}</button
					>
					<button
						type="button"
						class="inline-flex h-8 cursor-pointer items-center rounded-lg border px-3 text-[12.5px] hover:bg-muted"
						onclick={() => (editing = false)}>Cancel</button
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
					{/if}
				</div>
			</div>
		{/if}
	</div>
</div>
