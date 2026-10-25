<script lang="ts">
	// Tests a decision's branches: pick an outcome and any other values the branches read, and see
	// which of the steps that depend on the outcome would run, be skipped, or still wait.
	import {
		evaluateGuard,
		guardReferences,
		GuardSyntaxError,
		type DecisionNode
	} from '@casebook/model';
	import { CircleCheck, CircleDashed, CircleX, TriangleAlert } from '@lucide/svelte';
	import { labelOf, type ProcessIndex } from '$lib/graph/derive';
	import { choicesOf, describe, factOptions } from './conditions';
	import { samplesFor } from './samples.svelte';
	import SampleInput from './SampleInput.svelte';

	let {
		ix,
		decision,
		onselect
	}: { ix: ProcessIndex; decision: DecisionNode; onselect: (id: string) => void } = $props();

	const outcome = $derived(decision.core.outcome);
	const samples = $derived(samplesFor(ix.document.slug));
	const branches = $derived(
		ix.work.filter(
			(w) =>
				w.core.id !== decision.core.id &&
				w.core.when?.expr &&
				guardReferences(w.core.when.expr).facts.includes(outcome)
		)
	);
	const options = $derived(new Map(factOptions(ix).map((f) => [f.id, f])));
	const facts = $derived(
		[
			...new Set([outcome, ...branches.flatMap((b) => guardReferences(b.core.when!.expr!).facts)])
		].flatMap((id) => (options.get(id) ? [options.get(id)!] : []))
	);
	const now = $derived(new Date(`${samples.asOf}T12:00:00Z`));
	const answer = (expr: string) => {
		try {
			const v = evaluateGuard(expr, samples.values, { now });
			return v === undefined ? 'wait' : v ? 'run' : 'skip';
		} catch (error) {
			if (error instanceof GuardSyntaxError) return 'error';
			throw error;
		}
	};
	function setValue(fact: string, value: unknown) {
		const next = { ...samples.values };
		if (value === undefined) delete next[fact];
		else next[fact] = value;
		samples.values = next;
		samples.from = undefined;
	}
</script>

<div class="flex flex-col gap-3 rounded-xl border bg-muted/30 p-3">
	<span class="text-[12px] font-medium">Which way would it go?</span>
	<div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
		{#each facts as fact (fact.id)}
			<SampleInput
				{fact}
				choices={choicesOf(ix, fact.id)}
				value={samples.values[fact.id]}
				onchange={(v) => setValue(fact.id, v)}
			/>
		{/each}
	</div>
	<ul class="flex flex-col gap-1.5 border-t pt-3" aria-live="polite">
		{#each branches as b (b.core.id)}
			{@const a = answer(b.core.when!.expr!)}
			<li class="flex items-start gap-2 text-[12.5px]">
				{#if a === 'run'}<CircleCheck class="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
				{:else if a === 'skip'}<CircleX class="mt-0.5 size-3.5 shrink-0 text-rose-600" />
				{:else if a === 'wait'}<CircleDashed class="mt-0.5 size-3.5 shrink-0 text-amber-600" />
				{:else}<TriangleAlert class="mt-0.5 size-3.5 shrink-0 text-destructive" />{/if}
				<div class="min-w-0">
					<button
						type="button"
						class="cursor-pointer font-medium hover:underline"
						onclick={() => onselect(b.core.id)}>{labelOf(ix, b.core.id)}</button
					>
					<span class="text-muted-foreground"
						>· {a === 'run'
							? 'runs'
							: a === 'skip'
								? 'is skipped'
								: a === 'wait'
									? 'waits for a value'
									: 'is decided by hand'}</span
					>
					<div class="text-[11.5px] text-muted-foreground">
						Only when {describe(ix, b.core.when!.expr!) ?? b.core.when!.text}
					</div>
				</div>
			</li>
		{:else}
			<li class="text-[12px] text-muted-foreground">
				No step depends on this decision’s outcome yet. Add a step for a choice above.
			</li>
		{/each}
	</ul>
</div>
