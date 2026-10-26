<script lang="ts">
	// Tests a decision's branches: for every choice of its outcome, which of the steps that depend
	// on the outcome would run, be skipped, or still wait, given sample values for anything else
	// their conditions read.
	import { page } from '$app/state';
	import {
		explainGuard,
		guardReferences,
		GuardSyntaxError,
		type DecisionNode
	} from '@casebook/model';
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import CircleDashed from '@lucide/svelte/icons/circle-dashed';
	import CircleMinus from '@lucide/svelte/icons/circle-minus';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { labelOf, type ProcessIndex } from '$lib/graph/derive';
	import { choicesOf, factInfo, factOptions, todayIso } from './conditions';
	import { samplesFor } from './samples.svelte';
	import SampleInput from './SampleInput.svelte';

	let {
		ix,
		decision,
		onselect
	}: { ix: ProcessIndex; decision: DecisionNode; onselect: (id: string) => void } = $props();

	const outcome = $derived(decision.core.outcome);
	const choices = $derived(choicesOf(ix, outcome) ?? []);
	const samples = $derived(
		samplesFor(page.params.instance ?? '', ix.document.slug, page.data.timeZone)
	);
	$effect(() => {
		samples.load();
	});
	const branches = $derived(
		ix.work.filter(
			(w) =>
				w.core.id !== decision.core.id &&
				w.core.when?.expr &&
				guardReferences(w.core.when.expr).facts.includes(outcome)
		)
	);
	const options = $derived(new Map(factOptions(ix).map((f) => [f.id, f])));
	const others = $derived(
		[...new Set(branches.flatMap((b) => guardReferences(b.core.when!.expr!).facts))]
			.filter((id) => id !== outcome)
			.flatMap((id) => (options.get(id) ? [options.get(id)!] : []))
	);
	const timed = $derived(
		branches.some((b) => /\b(?:today|days_since|add_days)\s*\(/.test(b.core.when!.expr!))
	);
	const info = $derived(factInfo(ix, samples.context?.people));
	function answer(expr: string, choice: string) {
		try {
			const t = explainGuard(expr, { ...samples.values, [outcome]: choice }, samples.options);
			return { result: t.result, missing: t.missing };
		} catch (error) {
			if (error instanceof GuardSyntaxError) return { result: 'error' as const, missing: [] };
			throw error;
		}
	}
</script>

<div class="flex flex-col gap-3 rounded-xl border bg-muted/30 p-3">
	<div class="flex flex-wrap items-center gap-2">
		<span class="text-[12px] font-medium">Which way would each choice go?</span>
		{#if others.length}
			<select
				class="ml-auto h-7 max-w-52 cursor-pointer rounded-md border bg-background px-1.5 text-[12px] outline-none focus:ring-2 focus:ring-brand-ring"
				aria-label="Fill the other values from a case"
				value=""
				onchange={(e) => {
					samples.fill(e.currentTarget.value);
					e.currentTarget.value = '';
				}}
			>
				<option value="">{samples.from ? `From ${samples.from}` : 'Fill from a case…'}</option>
				{#each samples.context?.cases ?? [] as c (c.id)}<option value={c.id}>{c.title}</option
					>{/each}
			</select>
		{/if}
	</div>
	{#if others.length}
		<div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
			{#each others as fact (fact.id)}
				<SampleInput
					{fact}
					choices={choicesOf(ix, fact.id)}
					people={samples.context?.people}
					value={samples.values[fact.id]}
					timeZone={samples.timeZone}
					onchange={(v) => samples.set(fact.id, v)}
				/>
			{/each}
		</div>
	{/if}
	{#if timed || others.some((f) => f.kind === 'date')}
		<div class="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
			<CalendarDays class="size-3.5" />
			{#if timed}
				<label class="flex items-center gap-2"
					>As if today were
					<input
						type="date"
						class="h-7 rounded-md border bg-background px-1.5 text-[12px] text-foreground outline-none focus:ring-2 focus:ring-brand-ring"
						value={samples.asOf}
						oninput={(e) => (samples.asOf = e.currentTarget.value || todayIso(samples.timeZone))}
					/>
				</label>
			{/if}
			<span>Dates use {samples.timeZone} time</span>
		</div>
	{/if}

	{#if branches.length}
		<ul class="flex flex-col divide-y rounded-lg border bg-background" aria-live="polite">
			{#each choices as choice (choice)}
				<li class="flex flex-col gap-1 px-2.5 py-2">
					<span class="text-[12.5px] font-medium">If it is {choice}</span>
					{#each branches as b (b.core.id)}
						{@const a = answer(b.core.when!.expr!, choice)}
						<div class="flex items-start gap-2 text-[12.5px]">
							{#if a.result === 'true'}<CircleCheck
									class="mt-0.5 size-3.5 shrink-0 text-emerald-600"
								/>
							{:else if a.result === 'false'}<CircleMinus
									class="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
								/>
							{:else if a.result === 'unknown'}<CircleDashed
									class="mt-0.5 size-3.5 shrink-0 text-amber-600"
								/>
							{:else}<TriangleAlert class="mt-0.5 size-3.5 shrink-0 text-destructive" />{/if}
							<span class="min-w-0">
								<button
									type="button"
									class="cursor-pointer hover:underline"
									onclick={() => onselect(b.core.id)}>{labelOf(ix, b.core.id)}</button
								>
								<span class="text-muted-foreground"
									>{a.result === 'true'
										? 'runs'
										: a.result === 'false'
											? 'is skipped'
											: a.result === 'unknown'
												? `waits for ${a.missing.map((f) => info(f).name).join(', ')}`
												: 'is decided by hand'}</span
								>
							</span>
						</div>
					{/each}
				</li>
			{/each}
		</ul>
	{:else}
		<p class="text-[12px] text-muted-foreground">
			No step depends on this decision’s outcome yet. Add a step for a choice above.
		</p>
	{/if}
</div>
