<script lang="ts">
	// Quick add at a point: name it and press Enter for a step, or pick a decision, or link to a
	// step that already exists. Opened by a stage's "+" and "Add step", a card's "+", dropping a
	// dragged link in space, right-click and the "+" on a link. Naming first keeps adding and naming
	// one edit, so one undo takes both back.
	import SquareStack from '@lucide/svelte/icons/square-stack';
	import Signpost from '@lucide/svelte/icons/signpost';
	import CornerDownRight from '@lucide/svelte/icons/corner-down-right';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Check from '@lucide/svelte/icons/check';
	import type { FactId } from '@casebook/model';
	import type { AddContext } from '$lib/graph/board-context.svelte';
	import { collectsOf, labelOf, type ProcessIndex, type WorkItem } from '$lib/graph/derive';

	let {
		ctx,
		ix,
		onadd,
		onlink,
		onclose
	}: {
		ctx: AddContext;
		ix: ProcessIndex;
		onadd: (kind: 'step' | 'decision', title: string, needs?: FactId[]) => void;
		onlink: (target: string) => void;
		onclose: () => void;
	} = $props();

	let el = $state<HTMLDivElement>();
	let query = $state('');
	let active = $state(0);
	// "after X": the new item needs what X records; click a fact off if it does not
	// svelte-ignore state_referenced_locally
	const offered = ctx.after
		? collectsOf(ix.byId.get(ctx.after) as WorkItem).map((c) => c.fact)
		: [];
	let picked = $state<FactId[]>([...offered]);
	const linking = $derived(!ctx.insert && !!(ctx.after || ctx.fact || ctx.branch));
	const source = $derived(ctx.after ?? ctx.branch?.decision);
	const targets = $derived(
		linking
			? ix.work
					.filter((w) => w.core.id !== source)
					.filter((w) => labelOf(ix, w.core.id).toLowerCase().includes(query.trim().toLowerCase()))
					.slice(0, 6)
			: []
	);
	const name = $derived(query.trim());
	const step = $derived({
		kind: 'step' as const,
		icon: SquareStack,
		text: name ? `Step “${name}”` : 'Step',
		id: ''
	});
	const decision = $derived({
		kind: 'decision' as const,
		icon: Signpost,
		text: name ? `Decision “${name}”` : 'Decision',
		id: ''
	});
	const options = $derived([
		...(ctx.insert ? [step] : ctx.kind === 'decision' ? [decision, step] : [step, decision]),
		...targets.map((t) => ({
			kind: 'link' as const,
			icon: ArrowRight,
			text: labelOf(ix, t.core.id),
			id: t.core.id
		}))
	]);
	const heading = $derived(
		ctx.insert
			? `Between ${labelOf(ix, ctx.insert.from)} and ${labelOf(ix, ctx.insert.to)}`
			: ctx.branch
				? `When ${labelOf(ix, ctx.branch.decision)} is ${ctx.branch.choice}`
				: ctx.fact
					? `Needs ${labelOf(ix, ctx.fact)}`
					: ctx.after
						? `After ${labelOf(ix, ctx.after)}`
						: `Add to ${labelOf(ix, ctx.stage)}`
	);
	let pos = $state({ x: 0, y: 0 });
	$effect(() => {
		if (!el) return;
		const r = el.getBoundingClientRect();
		pos = {
			x: Math.max(8, Math.min(ctx.x, window.innerWidth - r.width - 8)),
			y: Math.max(8, Math.min(ctx.y, window.innerHeight - r.height - 8))
		};
	});
	$effect(() => {
		void query;
		active = 0;
	});
	function run(i: number) {
		const o = options[i];
		if (!o) return;
		if (o.kind === 'link') onlink(o.id);
		else onadd(o.kind, name, ctx.after ? picked : undefined);
		onclose();
	}
	function key(e: KeyboardEvent) {
		e.stopPropagation();
		if (e.key === 'Escape') return onclose();
		if (e.key === 'ArrowDown') active = (active + 1) % options.length;
		if (e.key === 'ArrowUp') active = (active - 1 + options.length) % options.length;
		if (e.key === 'Enter') run(active);
		if (e.key.startsWith('Arrow') || e.key === 'Enter') e.preventDefault();
	}
	const focus = (node: HTMLInputElement) => node.focus();
</script>

<svelte:window onpointerdown={(e) => !el?.contains(e.target as Node) && onclose()} />
<div
	bind:this={el}
	class="fixed z-50 w-72 rounded-xl border bg-popover p-1.5 text-[13px] shadow-lg"
	style="left:{pos.x || ctx.x}px; top:{pos.y || ctx.y}px"
	role="dialog"
	aria-label="Add"
>
	<div
		class="flex items-center gap-1.5 px-1.5 pt-0.5 pb-1.5 text-[11px] font-medium text-muted-foreground"
	>
		<CornerDownRight class="size-3.5" /><span class="truncate">{heading}</span>
	</div>
	{#if offered.length}
		<div
			class="mb-1.5 flex flex-wrap items-center gap-1 px-1.5 text-[11.5px] text-muted-foreground"
		>
			<span class="mr-0.5">Needs</span>
			{#each offered as f (f)}
				{@const on = picked.includes(f)}
				<button
					class={[
						'inline-flex cursor-pointer items-center gap-1 rounded-md border px-1.5 py-0.5',
						on
							? 'border-brand-ring bg-brand-soft text-brand'
							: 'bg-background line-through opacity-70'
					]}
					aria-pressed={on}
					title={on ? 'Click if it does not need this' : 'Click if it needs this'}
					onclick={() => (picked = on ? picked.filter((x) => x !== f) : [...picked, f])}
					>{#if on}<Check class="size-3" />{/if}{labelOf(ix, f)}</button
				>
			{/each}
		</div>
	{/if}
	<input
		class="mb-1 h-8 w-full rounded-lg bg-muted/70 px-2.5 text-[13px] outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-brand-ring"
		placeholder="Name it, then Enter"
		aria-label="Name"
		bind:value={query}
		use:focus
		onkeydown={key}
	/>
	{#each options as o, i (o.kind + o.id)}
		{#if o.kind === 'link' && options[i - 1]?.kind !== 'link'}
			<div class="mt-1 border-t px-2 pt-1.5 pb-0.5 text-[11px] text-muted-foreground">
				Or link to a step that exists
			</div>
		{/if}
		<button
			class={[
				'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left',
				active === i && 'bg-muted'
			]}
			onpointerenter={() => (active = i)}
			onclick={() => run(i)}
		>
			<o.icon class="size-4 shrink-0 text-muted-foreground" />
			<span class="min-w-0 flex-1 truncate">{o.text}</span>
			{#if active === i}<kbd
					class="shrink-0 rounded-md border bg-background px-1.5 text-[10.5px] text-muted-foreground"
					>Enter</kbd
				>{/if}
		</button>
	{/each}
</div>
