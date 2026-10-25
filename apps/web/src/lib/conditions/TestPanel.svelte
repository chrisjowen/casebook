<script lang="ts">
	// Tests a condition with sample values: one input per fact it reads, or values filled from a
	// case running the process. Shows the answer, what it is waiting for, and each part's answer so
	// the part that failed is plain. Sample values are shared by every condition of the process.
	import { page } from '$app/state';
	import {
		explainGuard,
		guardReferences,
		GuardSyntaxError,
		type GuardTrace
	} from '@casebook/model';
	import { CalendarDays, CircleCheck, CircleDashed, CircleX, TriangleAlert } from '@lucide/svelte';
	import type { ProcessIndex } from '$lib/graph/derive';
	import { choicesOf, factInfo, factOptions, todayIso } from './conditions';
	import { loadCases, samplesFor } from './samples.svelte';
	import SampleInput from './SampleInput.svelte';
	import Trace from './Trace.svelte';

	let {
		ix,
		expr,
		outcome,
		also = []
	}: {
		ix: ProcessIndex;
		expr: string;
		/** What each answer means for the step, such as "This step runs". */
		outcome: { true: string; false: string; unknown: string };
		/** More facts to ask for, before the ones the condition reads. */
		also?: string[];
	} = $props();

	const samples = $derived(samplesFor(ix.document.slug));
	const options = $derived(new Map(factOptions(ix).map((f) => [f.id, f])));
	const facts = $derived(
		[...new Set([...also, ...guardReferences(expr).facts])].flatMap((id) => {
			const f = options.get(id);
			return f ? [f] : [];
		})
	);
	const timed = $derived(/\b(?:today|days_since|add_days)\s*\(/.test(expr));
	const result = $derived.by((): GuardTrace | { error: string } => {
		try {
			return explainGuard(expr, samples.values, { now: new Date(`${samples.asOf}T12:00:00Z`) });
		} catch (error) {
			if (error instanceof GuardSyntaxError) return { error: error.message };
			throw error;
		}
	});
	const info = $derived(factInfo(ix));

	let cases = $state<{ id: string; title: string }[] | undefined>();
	let loadError = $state<string | undefined>();
	async function openCases() {
		if (cases) return;
		try {
			cases = await loadCases(page.params.instance ?? '', ix.document.slug);
		} catch (error) {
			loadError = error instanceof Error ? error.message : String(error);
		}
	}
	function fill(caseId: string) {
		const c = samples.cases?.find((x) => x.id === caseId);
		if (!c) return;
		samples.values = { ...c.facts };
		samples.from = c.title;
	}
	function setValue(fact: string, value: unknown) {
		const next = { ...samples.values };
		if (value === undefined) delete next[fact];
		else next[fact] = value;
		samples.values = next;
		samples.from = undefined;
	}
	const missingNames = (missing: string[]) => missing.map((f) => info(f).name).join(', ');
</script>

<div class="flex flex-col gap-3 rounded-xl border bg-muted/30 p-3">
	<div class="flex flex-wrap items-center gap-2">
		<span class="text-[12px] font-medium">Try it with sample values</span>
		<select
			class="ml-auto h-7 max-w-48 cursor-pointer rounded-md border bg-background px-1.5 text-[12px] outline-none focus:ring-2 focus:ring-brand-ring"
			aria-label="Fill the values from a case"
			onfocus={openCases}
			onpointerdown={openCases}
			value=""
			onchange={(e) => {
				fill(e.currentTarget.value);
				e.currentTarget.value = '';
			}}
		>
			<option value="">{samples.from ? `From ${samples.from}` : 'Fill from a case…'}</option>
			{#if cases}
				{#each cases as c (c.id)}<option value={c.id}>{c.title}</option>{:else}<option disabled
						>No cases run this process yet</option
					>{/each}
			{:else if loadError}<option disabled>{loadError}</option>
			{:else}<option disabled>Loading cases…</option>{/if}
		</select>
	</div>

	{#if facts.length}
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
	{:else}
		<p class="text-[12px] text-muted-foreground">This condition reads no facts.</p>
	{/if}
	{#if timed}
		<label class="flex items-center gap-2 text-[12px] text-muted-foreground">
			<CalendarDays class="size-3.5" />As if today were
			<input
				type="date"
				class="h-7 rounded-md border bg-background px-1.5 text-[12px] text-foreground outline-none focus:ring-2 focus:ring-brand-ring"
				value={samples.asOf}
				oninput={(e) => (samples.asOf = e.currentTarget.value || todayIso())}
			/>
		</label>
	{/if}

	<div aria-live="polite" class="flex flex-col gap-2 border-t pt-3">
		{#if 'error' in result}
			<p class="flex items-start gap-2 text-[12.5px] text-destructive">
				<TriangleAlert class="mt-0.5 size-4 shrink-0" />Fix the code to test it: {result.error}
			</p>
		{:else}
			{@const r = result.result}
			<div
				class={[
					'flex items-start gap-2 rounded-lg px-2.5 py-2 text-[13px]',
					r === 'true' &&
						'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200',
					r === 'false' && 'bg-rose-50 text-rose-900 dark:bg-rose-950/40 dark:text-rose-200',
					r === 'unknown' && 'bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
					r === 'error' && 'bg-destructive/10 text-destructive'
				]}
			>
				{#if r === 'true'}<CircleCheck class="mt-0.5 size-4 shrink-0" />
				{:else if r === 'false'}<CircleX class="mt-0.5 size-4 shrink-0" />
				{:else if r === 'unknown'}<CircleDashed class="mt-0.5 size-4 shrink-0" />
				{:else}<TriangleAlert class="mt-0.5 size-4 shrink-0" />{/if}
				<div class="min-w-0">
					<div class="font-medium">
						{r === 'true'
							? 'Yes'
							: r === 'false'
								? 'No'
								: r === 'unknown'
									? 'Not yet'
									: 'Cannot tell'}
						<span class="font-normal"
							>· {r === 'true'
								? outcome.true
								: r === 'false'
									? outcome.false
									: r === 'unknown'
										? outcome.unknown
										: 'people decide by hand'}</span
						>
					</div>
					{#if r === 'unknown' && result.missing.length}
						<div class="text-[12px] opacity-80">Waiting for {missingNames(result.missing)}.</div>
					{:else if r === 'error'}
						<div class="text-[12px] opacity-80">{result.error}</div>
					{/if}
				</div>
			</div>
			{#if result.parts.length}
				<Trace parts={result.parts} {info} />
			{/if}
		{/if}
	</div>
</div>
