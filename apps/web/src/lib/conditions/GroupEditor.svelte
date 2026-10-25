<script lang="ts">
	// A group of rules, each "fact, operator, value", joined by "all of" or "any of". The top group
	// can hold one level of groups inside it, for conditions such as "A and (B or C)".
	import {
		operandOf,
		operatorLabel,
		operatorsFor,
		type ConditionKind,
		type Group,
		type Rule,
		type RuleOp
	} from '@casebook/model';
	import { Plus, X } from '@lucide/svelte';
	import type { ProcessIndex } from '$lib/graph/derive';
	import type { PersonView } from '@casebook/store';
	import { choicesOf, factInfo, type FactOption, type FactTiming } from './conditions';
	import GroupEditor from './GroupEditor.svelte';
	import ValuePicker from './ValuePicker.svelte';

	let {
		group = $bindable(),
		ix,
		options,
		depth = 0,
		onremove,
		timing,
		people
	}: {
		group: Group;
		ix: ProcessIndex;
		options: FactOption[];
		depth?: number;
		/** Removes this group from the one it is in; absent for the top group. */
		onremove?: () => void;
		/** When each fact is recorded, seen from the step, to list facts known by then first. */
		timing?: Map<string, FactTiming>;
		/** Who a people fact can hold, once loaded. */
		people?: PersonView[];
	} = $props();
	const known = $derived(timing ? options.filter((f) => timing.get(f.id) === 'before') : options);
	const unknown = $derived(timing ? options.filter((f) => timing.get(f.id) !== 'before') : []);

	const info = $derived(factInfo(ix));
	const kindOf = (rule: Rule): ConditionKind => (rule.fact ? info(rule.fact).kind : 'text');
	const joinWord = $derived(group.join === 'all' ? 'and' : 'or');

	function setFact(rule: Rule, fact: string) {
		rule.fact = fact;
		rule.value = undefined;
		const kind = kindOf(rule);
		if (!operatorsFor(kind).includes(rule.op)) rule.op = operatorsFor(kind)[0]!;
		if (kind === 'yesno' && rule.op === 'is') rule.value = true;
	}
	function setOp(rule: Rule, op: RuleOp) {
		const from = operandOf(rule.op);
		const to = operandOf(op);
		rule.op = op;
		if (from === to) return;
		if (from === 'one' && to === 'many' && rule.value !== undefined && !Array.isArray(rule.value)) {
			rule.value = [rule.value];
		} else if (from === 'many' && to === 'one' && Array.isArray(rule.value)) {
			rule.value = rule.value[0];
		} else rule.value = undefined;
	}
	const newRule = (): Rule => ({ kind: 'rule', fact: '', op: 'is' });
	const box =
		'h-8 min-w-0 cursor-pointer rounded-md border bg-background px-1.5 text-[12.5px] outline-none focus:ring-2 focus:ring-brand-ring';
</script>

<div class={['flex flex-col gap-2', depth > 0 && 'rounded-lg border border-dashed p-2.5']}>
	<div class="flex items-center gap-2 text-[12px] text-muted-foreground">
		<span>{depth === 0 ? 'When' : 'Where'}</span>
		<div
			role="radiogroup"
			aria-label="How the rules combine"
			class="inline-flex gap-0.5 rounded-md bg-muted p-0.5"
		>
			{#each [['all', 'all'], ['any', 'any']] as [value, text] (value)}
				<button
					type="button"
					role="radio"
					aria-checked={group.join === value}
					class={[
						'h-6 cursor-pointer rounded px-2 text-[12px]',
						group.join === value
							? 'bg-background font-medium text-foreground shadow-xs'
							: 'hover:text-foreground'
					]}
					onclick={() => (group.join = value as Group['join'])}>{text}</button
				>
			{/each}
		</div>
		<span>of these hold</span>
		{#if onremove}
			<button
				type="button"
				class="ml-auto flex size-6 cursor-pointer items-center justify-center rounded-md hover:bg-muted hover:text-destructive"
				aria-label="Remove this group"
				onclick={onremove}><X class="size-3.5" /></button
			>
		{/if}
	</div>

	{#each group.items as item, i (i)}
		{#if i > 0}
			<div class="-my-1 pl-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
				{joinWord}
			</div>
		{/if}
		{#if item.kind === 'group'}
			<GroupEditor
				group={item}
				{ix}
				{options}
				{timing}
				{people}
				depth={depth + 1}
				onremove={() => group.items.splice(i, 1)}
			/>
		{:else}
			{@const kind = kindOf(item)}
			{@const name = item.fact ? info(item.fact).name : 'the fact'}
			<div class="flex flex-wrap items-center gap-1.5 rounded-lg border bg-background p-1.5">
				<select
					class="{box} max-w-[11rem] flex-1 basis-32"
					aria-label="Fact"
					value={item.fact}
					onchange={(e) => setFact(item, e.currentTarget.value)}
				>
					<option value="" disabled>Pick a fact</option>
					{#if unknown.length}
						<optgroup label="Recorded before this step">
							{#each known as f (f.id)}<option value={f.id}>{f.name}</option>{/each}
						</optgroup>
						<optgroup label="Recorded by this step or later">
							{#each unknown as f (f.id)}<option value={f.id}>{f.name}</option>{/each}
						</optgroup>
					{:else}
						{#each options as f (f.id)}<option value={f.id}>{f.name}</option>{/each}
					{/if}
					{#if item.fact && !options.some((f) => f.id === item.fact)}
						<option value={item.fact}>{name}</option>
					{/if}
				</select>
				<select
					class="{box} max-w-[11rem]"
					aria-label="Operator for {name}"
					value={item.op}
					disabled={!item.fact}
					onchange={(e) => setOp(item, e.currentTarget.value as RuleOp)}
				>
					{#each operatorsFor(kind) as op (op)}<option value={op}
							>{operatorLabel(op, kind).replace(' … days ago', '')}</option
						>{/each}
				</select>
				{#if item.fact}
					<ValuePicker
						{kind}
						op={item.op}
						choices={choicesOf(ix, item.fact)}
						value={item.value}
						onchange={(v) => (item.value = v)}
						label="Value for {name}"
						{people}
					/>
				{/if}
				<button
					type="button"
					class="ml-auto flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-destructive"
					aria-label="Remove this rule"
					onclick={() => group.items.splice(i, 1)}><X class="size-3.5" /></button
				>
			</div>
		{/if}
	{/each}

	<div class="flex flex-wrap gap-1.5">
		<button
			type="button"
			class="inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-[12px] text-brand hover:bg-brand-soft"
			onclick={() => group.items.push(newRule())}
			><Plus class="size-3.5" />{group.items.length
				? `Add an “${joinWord}” rule`
				: 'Add a rule'}</button
		>
		{#if depth === 0}
			<button
				type="button"
				class="inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground"
				onclick={() =>
					group.items.push({
						kind: 'group',
						join: group.join === 'all' ? 'any' : 'all',
						items: [newRule()]
					})}><Plus class="size-3.5" />Add a group</button
			>
		{/if}
	</div>
</div>
