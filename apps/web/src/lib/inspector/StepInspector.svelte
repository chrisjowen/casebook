<script lang="ts">
	// Definition inspector for a step or decision: what it collects, who does it, what it needs,
	// when it runs, approvals and source. Read-only; nothing here is a form to fill in.
	import type { ApprovalNode, FactNode } from '@casebook/model';
	import {
		collectorsByFact,
		collectsOf,
		describeEvidence,
		evidenceFor,
		factType,
		humanizeDuration,
		labelOf,
		requiresOf,
		type ProcessIndex,
		type WorkItem
	} from '$lib/graph/derive';
	import { roleTone } from '$lib/graph/layout';
	import { toneBar } from '$lib/graph/tones';
	import { glyphIcon } from '$lib/graph/glyphs';
	import Field from './Field.svelte';
	import Group from './Group.svelte';
	import Expr from './Expr.svelte';
	import FieldPreview from './FieldPreview.svelte';
	import {
		ShieldCheck,
		Split,
		Repeat,
		Sparkles,
		FileText,
		TriangleAlert,
		ArrowLeft,
		Eye,
		ChevronRight,
		UserPlus
	} from '@lucide/svelte';

	let { ix, item, onfact }: { ix: ProcessIndex; item: WorkItem; onfact: (id: string) => void } =
		$props();

	const core = $derived(item.core);
	const step = $derived(core.kind === 'step' ? core : undefined);
	const role = $derived(ix.roles.find((r) => r.core.id === core.role));
	const approval = $derived(
		step?.approval ? (ix.byId.get(step.approval) as ApprovalNode | undefined) : undefined
	);
	const collectors = $derived(collectorsByFact(ix));
	const needs = $derived(
		requiresOf(item).map((fact) => {
			const from = (collectors.get(fact) ?? []).filter((id) => id !== core.id);
			const evidence = evidenceFor(ix, item, fact);
			return {
				fact,
				from: from.map((id) => labelOf(ix, id)),
				evidence: evidence && describeEvidence(evidence)
			};
		})
	);
	const actors = [
		{ value: 'human', label: 'Person' },
		{ value: 'agent', label: 'Agent' },
		{ value: 'either', label: 'Either' }
	] as const;
	let preview = $state(false);
</script>

<div class="flex flex-col">
	<div class="flex flex-col gap-3.5 px-5 pt-4 pb-5">
		<Field label={core.kind === 'decision' ? 'Decision' : 'Step'}>{labelOf(ix, core.id)}</Field>
		<div class="grid grid-cols-2 gap-3">
			<Field label="Stage">{labelOf(ix, core.stage)}</Field>
			<Field label="Role">
				<span class="flex items-center gap-1.5"
					><span class={['size-2 shrink-0 rounded-full', toneBar[roleTone(ix, core.role)]]}
					></span>{labelOf(ix, core.role)}</span
				>
			</Field>
		</div>
		{#if role?.core.scope === 'case'}
			<p class="-mt-1.5 text-[11px] text-muted-foreground">
				People in this role are assigned for each case, not standing.
			</p>
		{/if}
		<div class="flex flex-col gap-1.5">
			<div class="text-[12px] text-muted-foreground">Who can complete it</div>
			<div
				class="grid grid-cols-3 gap-1 rounded-lg bg-muted/70 p-1"
				role="radiogroup"
				aria-label="Who can complete it"
			>
				{#each actors as a (a.value)}
					<span
						role="radio"
						aria-checked={core.actor === a.value}
						aria-disabled="true"
						class={[
							'rounded-md py-1.5 text-center text-[12.5px]',
							core.actor === a.value
								? 'bg-background font-medium shadow-xs'
								: 'text-muted-foreground'
						]}>{a.label}</span
					>
				{/each}
			</div>
		</div>
		{#if item.content}<Field label="Guidance">{item.content}</Field>{/if}
	</div>

	<Group title={core.kind === 'decision' ? 'Outcome' : 'Collects'} count={collectsOf(item).length}>
		<ul class="flex flex-col gap-1.5">
			{#each collectsOf(item) as collect (collect.fact)}
				{@const fact = ix.byId.get(collect.fact) as FactNode | undefined}
				{@const type = factType(fact?.core.schema)}
				{@const Glyph = glyphIcon[type.glyph]}
				{@const evidence = evidenceFor(ix, item, collect.fact)}
				<li>
					<button
						class="flex w-full cursor-pointer flex-col gap-1 rounded-lg border px-3 py-2 text-left hover:border-brand-ring hover:bg-brand-soft/40"
						onclick={() => onfact(collect.fact)}
					>
						<span class="flex items-center gap-2">
							<Glyph class="size-3.5 shrink-0 text-muted-foreground" />
							<span class="min-w-0 flex-1 truncate text-[13px] font-medium"
								>{labelOf(ix, collect.fact)}</span
							>
							<span class="rounded-md border bg-background px-1.5 text-[11px] text-muted-foreground"
								>{type.label}</span
							>
						</span>
						<span class="flex flex-wrap gap-x-3 gap-y-0.5 pl-5.5 text-[11px] text-muted-foreground">
							<span>Recorded by {labelOf(ix, collect.by ?? core.role)}</span>
							{#if evidence}<span class="flex items-center gap-1"
									><FileText class="size-3" />{describeEvidence(evidence)}</span
								>{/if}
							{#if fact?.core.schema['x-sensitivity'] === 'sensitive'}<span>Sensitive</span>{/if}
						</span>
					</button>
				</li>
			{:else}
				<li class="text-[12px] text-muted-foreground">Nothing is recorded by this step.</li>
			{/each}
		</ul>
		{#if step?.assigns?.length}
			{#each step.assigns as assign (assign.role)}
				<div
					class="flex items-start gap-2 rounded-lg border border-dashed px-3 py-2 text-[12px] text-muted-foreground"
				>
					<UserPlus class="mt-0.5 size-3.5 shrink-0" />
					<span
						>Assigns the people in “{labelOf(ix, assign.fact)}” to the {labelOf(ix, assign.role)} role
						for the case.</span
					>
				</div>
			{/each}
		{/if}
		{#if collectsOf(item).length}
			<button
				class="flex cursor-pointer items-center gap-1.5 self-start text-[12px] text-muted-foreground hover:text-foreground"
				aria-expanded={preview}
				onclick={() => (preview = !preview)}
			>
				<Eye class="size-3.5" />{preview ? 'Hide' : 'Show'} form preview<ChevronRight
					class={['size-3.5 transition-transform', preview && 'rotate-90']}
				/>
			</button>
			{#if preview}
				<div class="rounded-xl border border-dashed bg-muted/30 p-3">
					<p class="mb-2.5 text-[11px] font-medium text-muted-foreground">
						Preview of what this step will ask. Read-only; nothing is filled in here.
					</p>
					<div class="pointer-events-none flex flex-col gap-3 opacity-80 select-none" inert>
						{#each collectsOf(item) as collect (collect.fact)}
							{@const fact = ix.byId.get(collect.fact) as FactNode | undefined}
							{#if fact}<FieldPreview {ix} {fact} />{/if}
						{/each}
					</div>
				</div>
			{/if}
		{/if}
	</Group>

	{#if step?.evidence?.some((e) => !e.fact)}
		<Group title="Evidence">
			{#each step.evidence.filter((e) => !e.fact) as e (e.description)}
				<div class="flex items-start gap-2 text-[12.5px]">
					<FileText class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />{e.description} · {describeEvidence(
						e
					)}
				</div>
			{/each}
		</Group>
	{/if}

	<Group title="Needs first" count={needs.length}>
		{#if needs.length}
			<ul class="flex flex-col divide-y rounded-lg border">
				{#each needs as need (need.fact)}
					<li class="flex items-start gap-3 px-3 py-2 text-[12.5px]">
						<span class="min-w-0 flex-1">
							<span class="block">{labelOf(ix, need.fact)}</span>
							{#if need.evidence}<span
									class="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground"
									><FileText class="size-3" />{need.evidence}</span
								>{/if}
						</span>
						{#if need.from.length}
							<span
								class="flex max-w-[45%] shrink-0 items-start gap-1 text-right text-[11px] text-muted-foreground"
								><ArrowLeft class="mt-0.5 size-3 shrink-0" />{need.from.join(', ')}</span
							>
						{:else}
							<span class="flex shrink-0 items-center gap-1 text-[11px] text-amber-700"
								><TriangleAlert class="size-3" />Nothing collects this</span
							>
						{/if}
					</li>
				{/each}
			</ul>
		{:else}
			<p class="text-[12px] text-muted-foreground">Nothing. This can start straight away.</p>
		{/if}
	</Group>

	<Group title="Condition">
		{#if core.when}
			<Field label="When it runs"
				><span class="flex items-start gap-2"
					><Split class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />{core.when.text}</span
				></Field
			>
			{#if core.when.expr}
				<div class="flex flex-col gap-1.5">
					<div class="text-[12px] text-muted-foreground">Checked automatically</div>
					<Expr expr={core.when.expr} {ix} />
				</div>
			{:else}
				<p class="text-[11px] text-muted-foreground">
					No expression yet, so the {labelOf(ix, core.role)} confirms it when the time comes (ADR 0004).
				</p>
			{/if}
		{/if}
		{#if step?.repeat}
			<Field label="Repeats">
				<span class="flex items-start gap-2"
					><Repeat class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />{step.repeat.every
						? `Every ${humanizeDuration(step.repeat.every)}. `
						: ''}{step.repeat.until.text}</span
				>
			</Field>
			{#if step.repeat.until.expr}<Expr expr={step.repeat.until.expr} {ix} />{/if}
		{/if}
		{#if !core.when && !step?.repeat}<p class="text-[12px] text-muted-foreground">
				Always runs once its inputs exist.
			</p>{/if}
	</Group>

	{#if core.kind === 'step'}
		<Group title="Approval">
			{#if approval}
				<div class="flex items-start gap-2.5 rounded-lg border px-3 py-2">
					<ShieldCheck class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
					<div class="text-[12.5px]">
						<div class="font-medium">{labelOf(ix, approval.core.id)}</div>
						<div class="text-[11px] text-muted-foreground">
							By {labelOf(ix, approval.core.role)} · {approval.core.actor === 'human'
								? 'a person must approve; agents cannot'
								: approval.core.actor === 'agent'
									? 'an agent approves'
									: 'a person or an agent'}
						</div>
						{#if approval.content}<p class="mt-1 text-[12px] text-muted-foreground">
								{approval.content}
							</p>{/if}
					</div>
				</div>
			{:else}
				<p class="text-[12px] text-muted-foreground">No approval needed.</p>
			{/if}
		</Group>
	{/if}

	<Group title="Source">
		{#if core.source}
			<Field label={core.source.inferred ? 'Inferred from' : 'Taken from'}>
				<span class="flex items-start gap-2">
					{#if core.source.inferred}<Sparkles
							class="mt-0.5 size-3.5 shrink-0 text-brand"
						/>{:else}<FileText class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />{/if}
					{core.source.doc}{core.source.ref ? ` · ${core.source.ref}` : ''}
				</span>
			</Field>
			{#if core.source.inferred}<p class="text-[11px] text-muted-foreground">
					Not stated in the source; inferred when the definition was drafted.
				</p>{/if}
		{:else}
			<p class="text-[12px] text-muted-foreground">Added by hand.</p>
		{/if}
	</Group>
</div>
