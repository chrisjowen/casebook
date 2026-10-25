<script lang="ts">
	// What a link carries. A link between two steps is never a bare line: the later step needs
	// facts the earlier one records. Tick the ones it needs, or name a new one for the earlier step
	// to record. From a decision, pick which choice the later step runs for.
	import type { DecisionNode, FactId, FactNode, Operation } from '@casebook/model';
	import { ArrowRight, Check, Plus } from '@lucide/svelte';
	import { branchChoices } from '$lib/conditions/conditions';
	import type { PickerState } from '$lib/graph/board-context.svelte';
	import {
		choiceLabel,
		choiceValues,
		collectsOf,
		factType,
		labelOf,
		type ProcessIndex,
		type WorkItem
	} from '$lib/graph/derive';
	import { glyphIcon } from '$lib/graph/glyphs';
	import { FACT_KINDS, branchTo, factByTitle, newFact, setNeeds, setWhen, type Edit } from './ops';

	let {
		state: box,
		ix,
		edit,
		onclose
	}: {
		state: PickerState;
		ix: ProcessIndex;
		edit: (e: Edit) => Promise<boolean>;
		onclose: () => void;
	} = $props();

	let el = $state<HTMLDivElement>();
	let name = $state('');
	let kind = $state(0);
	const from = $derived(ix.byId.get(box.from) as WorkItem | undefined);
	const to = $derived(ix.byId.get(box.to) as WorkItem | undefined);
	const offered = $derived(from ? collectsOf(from).map((c) => c.fact) : []);
	const needs = $derived(new Set<string>(to?.core.requires ?? []));
	const decision = $derived(from?.core.kind === 'decision' ? (from as DecisionNode) : undefined);
	const choices = $derived.by(() => {
		const outcome = decision
			? (ix.byId.get(decision.core.outcome) as FactNode | undefined)
			: undefined;
		return choiceValues(ix, outcome?.core.id);
	});
	const branch = $derived(decision && to ? branchChoices(ix, decision, to) : []);

	let pos = $state({ x: 0, y: 0 });
	$effect(() => {
		if (!el) return;
		const r = el.getBoundingClientRect();
		pos = {
			x: Math.max(8, Math.min(box.x, window.innerWidth - r.width - 8)),
			y: Math.max(8, Math.min(box.y, window.innerHeight - r.height - 8))
		};
	});

	const toggle = (fact: FactId) => edit(setNeeds(ix, box.to, fact, !needs.has(fact)));
	async function create(e: KeyboardEvent) {
		e.stopPropagation();
		if (e.key === 'Escape') return onclose();
		if (e.key !== 'Enter' || !name.trim()) return;
		const existing = factByTitle(ix, name);
		let change: Edit;
		if (existing) {
			const id = existing.core.id;
			const ops: Operation[] = [];
			if (!offered.includes(id))
				ops.push({ op: 'link', from: box.from as never, edge: 'collects', to: id });
			if (!needs.has(id)) ops.push(setNeeds(ix, box.to, id, true).ops[0]);
			change = {
				ops,
				label: `${labelOf(ix, box.to)} now needs ${labelOf(ix, id)} from ${labelOf(ix, box.from)}`
			};
		} else {
			change = newFact(ix.document, name.trim(), FACT_KINDS[kind].schema, {
				collector: box.from,
				needers: [box.to]
			});
		}
		if (change.ops.length && (await edit(change))) {
			name = '';
			kind = 0;
		}
	}
	function runsWhen(choice: string) {
		if (!decision) return;
		if (choice) return edit(branchTo(ix, decision.core.id, choice, box.to));
		return edit({
			ops: [setWhen(box.to, null)],
			label: `${labelOf(ix, box.to)} runs whatever ${labelOf(ix, decision.core.id)} decides`
		});
	}
	async function removeLink() {
		const linked = offered.filter((f) => needs.has(f));
		const ok = await edit({
			ops: linked.map((f) => setNeeds(ix, box.to, f, false).ops[0]),
			label: `${labelOf(ix, box.to)} no longer waits for ${labelOf(ix, box.from)}`
		});
		if (ok) onclose();
	}
	const focus = (node: HTMLInputElement, on: boolean) => {
		if (on) node.focus();
	};
</script>

<svelte:window onpointerdown={(e) => !el?.contains(e.target as Node) && onclose()} />
{#if from && to}
	<div
		bind:this={el}
		class="fixed z-50 w-80 rounded-xl border bg-popover text-[13px] shadow-lg"
		style="left:{pos.x || box.x}px; top:{pos.y || box.y}px"
		role="dialog"
		aria-label="What is handed over"
	>
		<div class="flex items-center gap-1.5 border-b px-3.5 py-2.5 text-[12.5px] font-medium">
			<span class="truncate">{labelOf(ix, box.from)}</span>
			<ArrowRight class="size-3.5 shrink-0 text-muted-foreground" />
			<span class="truncate">{labelOf(ix, box.to)}</span>
		</div>
		<div class="flex flex-col gap-2.5 px-3.5 py-3">
			{#if decision}
				<label class="flex flex-col gap-1 text-[12px] text-muted-foreground"
					>Runs when {labelOf(ix, decision.core.id)} is
					<select
						class="h-8 cursor-pointer rounded-lg border bg-background px-2 text-[12.5px] text-foreground outline-none focus:ring-2 focus:ring-brand-ring"
						value={branch.length > 1 ? 'several' : (branch[0] ?? '')}
						onchange={(e) => runsWhen(e.currentTarget.value)}
					>
						<option value="">Any outcome</option>
						{#if branch.length > 1}<option value="several" disabled
								>{branch
									.map((c) => choiceLabel(ix, decision?.core.outcome, c))
									.join(' or ')}</option
							>{/if}
						{#each choices as c (c)}<option value={c}
								>{choiceLabel(ix, decision?.core.outcome, c)}</option
							>{/each}
					</select>
				</label>
			{/if}
			<div class="text-[12px] text-muted-foreground">
				{labelOf(ix, box.to)} needs from {labelOf(ix, box.from)}
			</div>
			{#if offered.length}
				<ul class="flex flex-col gap-0.5">
					{#each offered as fact (fact)}
						{@const k = factType((ix.byId.get(fact) as FactNode | undefined)?.core.schema)}
						{@const Glyph = glyphIcon[k.glyph]}
						<li>
							<button
								class="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-muted"
								role="checkbox"
								aria-checked={needs.has(fact)}
								onclick={() => toggle(fact)}
							>
								<span
									class={[
										'flex size-4 shrink-0 items-center justify-center rounded border',
										needs.has(fact) ? 'border-brand bg-brand text-white' : 'bg-background'
									]}
									>{#if needs.has(fact)}<Check class="size-3" />{/if}</span
								>
								<Glyph class="size-3.5 shrink-0 text-muted-foreground" />
								<span class="min-w-0 flex-1 truncate">{labelOf(ix, fact)}</span>
								<span class="text-[11px] text-muted-foreground">{k.label}</span>
							</button>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="rounded-lg bg-muted/60 px-2.5 py-2 text-[12px] text-muted-foreground">
					{labelOf(ix, box.from)} records nothing yet. Name what it hands over:
				</p>
			{/if}
			{#if from.core.kind === 'step'}
				<div class="flex items-center gap-1.5">
					<Plus class="size-3.5 shrink-0 text-muted-foreground" />
					<input
						class="h-8 min-w-0 flex-1 rounded-lg bg-muted/70 px-2.5 text-[12.5px] outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-brand-ring"
						placeholder="New fact it hands over"
						aria-label="New fact it hands over"
						bind:value={name}
						use:focus={!!box.create || !offered.length}
						onkeydown={create}
					/>
					<select
						class="h-8 cursor-pointer rounded-lg border bg-background px-1.5 text-[12px] outline-none"
						aria-label="Kind"
						bind:value={kind}
					>
						{#each FACT_KINDS as k, i (k.label)}<option value={i}>{k.label}</option>{/each}
					</select>
				</div>
			{/if}
		</div>
		<div class="flex items-center justify-between border-t px-2 py-1.5">
			<button
				class="cursor-pointer rounded-lg px-2 py-1 text-[12px] text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-40"
				disabled={!offered.some((f) => needs.has(f))}
				onclick={removeLink}>Remove link</button
			>
			<button
				class="cursor-pointer rounded-lg bg-foreground px-3 py-1 text-[12px] font-medium text-background hover:opacity-90"
				onclick={onclose}>Done</button
			>
		</div>
	</div>
{/if}
