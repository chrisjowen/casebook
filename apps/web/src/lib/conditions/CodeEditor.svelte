<script lang="ts">
	// Condition code for people who prefer typing it: suggestions of facts, operators, choices and
	// helpers as they type (↑ ↓ to move, Enter or Tab to take one, Esc to close, Ctrl+Space to ask),
	// a live check that shows what is wrong and where, and the helpers' reference.
	import { tick } from 'svelte';
	import { GUARD_HELPERS } from '@casebook/model';
	import { BookOpen, ChevronRight, CircleCheck, TriangleAlert } from '@lucide/svelte';
	import type { ProcessIndex } from '$lib/graph/derive';
	import { checkCode, complete, helperExample, type Completion } from './conditions';

	let {
		ix,
		value = $bindable(),
		label
	}: { ix: ProcessIndex; value: string; label: string } = $props();

	let field = $state<HTMLTextAreaElement>();
	let open = $state<Completion | undefined>();
	let active = $state(0);
	let reference = $state(false);
	const problem = $derived(value.trim() ? checkCode(ix, value) : undefined);
	// The check shows once typing pauses, so a half-typed name is not an error yet.
	let settled = $state(value);
	$effect(() => {
		const typed = value;
		const wait = setTimeout(() => (settled = typed), 700);
		return () => clearTimeout(wait);
	});
	const shown = $derived(settled === value ? problem : undefined);
	const listId = $derived(`code-suggestions-${ix.document.slug}`);

	function suggest(force = false) {
		if (!field) return;
		const at = field.selectionStart;
		if (field.selectionEnd !== at) return (open = undefined);
		const result = complete(ix, value, at);
		const typing = at > result.from;
		open =
			result.items.length && (force || typing || /[\s([,=<>]$/.test(value.slice(0, at)))
				? result
				: undefined;
		active = 0;
	}
	async function take(i: number) {
		const item = open?.items[i];
		if (!item || !field) return;
		const at = field.selectionStart;
		const before = value.slice(0, open!.from);
		const after = value.slice(at);
		const spaced =
			/^[\s,)\]]/.test(after) || item.insert.endsWith(' ') || item.kind === 'helper' ? '' : ' ';
		value = `${before}${item.insert}${spaced}${after}`;
		const cursor = before.length + (item.cursor ?? item.insert.length + spaced.length);
		open = undefined;
		await tick();
		field.focus();
		field.setSelectionRange(cursor, cursor);
		suggest();
	}
	/** Puts a helper's example at the cursor, as written for this process's facts. */
	async function insert(text: string) {
		const at = field?.selectionStart ?? value.length;
		const end = field?.selectionEnd ?? at;
		const pad = at > 0 && !/\s$/.test(value.slice(0, at)) ? ' ' : '';
		value = `${value.slice(0, at)}${pad}${text}${value.slice(end)}`;
		await tick();
		const cursor = at + pad.length + text.length;
		field?.focus();
		field?.setSelectionRange(cursor, cursor);
	}
	function keydown(e: KeyboardEvent) {
		e.stopPropagation();
		if (e.key === ' ' && e.ctrlKey) {
			e.preventDefault();
			return suggest(true);
		}
		if (!open) return;
		const n = open.items.length;
		if (e.key === 'ArrowDown') active = (active + 1) % n;
		else if (e.key === 'ArrowUp') active = (active - 1 + n) % n;
		else if (e.key === 'Enter' || e.key === 'Tab') take(active);
		else if (e.key === 'Escape') open = undefined;
		else return;
		e.preventDefault();
	}
	const tone = {
		fact: 'bg-brand-soft text-brand',
		helper: 'bg-sky-50 text-sky-800 dark:bg-sky-950/50 dark:text-sky-200',
		operator: 'bg-muted text-foreground',
		value: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200',
		word: 'bg-muted text-muted-foreground'
	};
</script>

<div class="flex flex-col gap-2">
	<div class="relative">
		<textarea
			bind:this={field}
			bind:value
			class={[
				'min-h-[76px] w-full resize-y rounded-lg border bg-background px-3 py-2 font-mono text-[12.5px] leading-relaxed outline-none focus:ring-2',
				shown ? 'border-destructive/50 focus:ring-destructive/30' : 'focus:ring-brand-ring'
			]}
			spellcheck="false"
			autocomplete="off"
			aria-label={label}
			aria-invalid={!!shown}
			aria-autocomplete="list"
			aria-controls={open ? listId : undefined}
			aria-activedescendant={open ? `${listId}-${active}` : undefined}
			placeholder="fact.severity in ['SEV1', 'SEV2']"
			oninput={() => suggest()}
			onkeydown={keydown}
			onclick={() => (open = undefined)}
			onblur={() => setTimeout(() => (open = undefined), 120)}></textarea>
		{#if open}
			<ul
				id={listId}
				role="listbox"
				aria-label="Suggestions"
				class="absolute inset-x-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg"
			>
				{#each open.items as item, i (item.kind + item.label)}
					<li
						id="{listId}-{i}"
						role="option"
						aria-selected={i === active}
						class={[
							'flex cursor-pointer items-baseline gap-2 rounded-md px-2 py-1.5 text-[12.5px]',
							i === active ? 'bg-muted' : 'hover:bg-muted/60'
						]}
						onpointerdown={(e) => {
							e.preventDefault();
							take(i);
						}}
					>
						<span
							class={[
								'shrink-0 rounded px-1 font-mono text-[10.5px] tracking-wide',
								tone[item.kind]
							]}
							>{item.kind === 'fact'
								? 'fact'
								: item.kind === 'helper'
									? 'fx'
									: item.kind === 'value'
										? 'choice'
										: item.kind === 'operator'
											? 'op'
											: 'word'}</span
						>
						<span class={['shrink-0', item.kind !== 'fact' && 'font-mono']}>{item.label}</span>
						<span class="min-w-0 truncate text-[11.5px] text-muted-foreground">{item.detail}</span>
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	{#if shown}
		<div class="flex flex-col gap-1 text-[12px]" role="alert">
			<span class="flex items-start gap-1.5 text-destructive"
				><TriangleAlert class="mt-0.5 size-3.5 shrink-0" />{shown.message}</span
			>
			<code
				class="block rounded-md bg-muted/70 px-2 py-1 font-mono text-[11.5px] break-all whitespace-pre-wrap text-muted-foreground"
				>{value.slice(0, shown.at)}<mark
					class="rounded-sm bg-destructive/15 text-destructive underline decoration-destructive decoration-wavy underline-offset-2"
					>{value.slice(shown.at, shown.at + shown.length) || ' '}</mark
				>{value.slice(shown.at + shown.length)}</code
			>
		</div>
	{:else if value.trim() && !problem}
		<span class="flex items-center gap-1.5 text-[12px] text-emerald-700 dark:text-emerald-400"
			><CircleCheck class="size-3.5" />The code works.</span
		>
	{/if}

	<button
		type="button"
		class="flex cursor-pointer items-center gap-1.5 self-start text-[12px] text-muted-foreground hover:text-foreground"
		aria-expanded={reference}
		onclick={() => (reference = !reference)}
		><BookOpen class="size-3.5" />Helpers you can use<ChevronRight
			class={['size-3.5 transition-transform', reference && 'rotate-90']}
		/></button
	>
	{#if reference}
		<dl class="flex flex-col gap-2 rounded-lg border bg-muted/30 p-2.5 text-[12px]">
			{#each GUARD_HELPERS as h (h.name)}
				{@const example = helperExample(ix, h.name, h.example)}
				<div>
					<dt class="font-mono text-[12px] font-medium">{h.signature}</dt>
					<dd class="text-muted-foreground">{h.description}</dd>
					<dd>
						<button
							type="button"
							class="cursor-pointer rounded px-1 font-mono text-[11px] text-brand hover:bg-brand-soft"
							title="Insert at the cursor"
							onclick={() => insert(example)}>{example}</button
						>
					</dd>
				</div>
			{/each}
			<div class="border-t pt-2 text-muted-foreground">
				Compare with <code class="font-mono">== != &lt; &lt;= &gt; &gt;= in</code>, combine with
				<code class="font-mono">and or not</code> and brackets, and write
				<code class="font-mono">null</code> for nothing recorded. Click an example to insert it.
			</div>
		</dl>
	{/if}
</div>
