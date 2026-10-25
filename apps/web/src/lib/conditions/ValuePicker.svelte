<script lang="ts">
	// The value side of a rule, shaped by the fact and the operator: choices to pick from, Yes or
	// No, a date or today, a number of days or items, or text.
	import { operandOf, type ConditionKind, type RuleOp, type RuleValue } from '@casebook/model';
	import type { PersonView } from '@casebook/store';

	let {
		kind,
		op,
		choices,
		value,
		onchange,
		label,
		people
	}: {
		kind: ConditionKind;
		op: RuleOp;
		choices: string[] | undefined;
		value: RuleValue | RuleValue[] | undefined;
		onchange: (value: RuleValue | RuleValue[] | undefined) => void;
		/** What the field is for, for screen readers: "Value for Severity". */
		label: string;
		/** Who a people fact can hold, once loaded. */
		people?: PersonView[];
	} = $props();

	const operand = $derived(operandOf(op));
	const box =
		'h-8 min-w-0 rounded-md border bg-background px-2 text-[12.5px] outline-none focus:ring-2 focus:ring-brand-ring';
	const many = $derived(Array.isArray(value) ? value : []);
	const isToday = $derived(value !== null && typeof value === 'object' && !Array.isArray(value));
	// Picked choices keep the order the fact lists them in.
	const toggle = (c: string) =>
		onchange(
			many.includes(c)
				? many.filter((v) => v !== c)
				: (choices ?? []).filter((x) => x === c || many.includes(x))
		);
	const unit = $derived(
		op === 'more-days-ago' || op === 'fewer-days-ago'
			? 'days'
			: kind === 'people'
				? 'people'
				: 'items'
	);
</script>

{#if operand === 'count'}
	<span class="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
		<input
			type="number"
			min="0"
			class="{box} w-16 text-foreground"
			aria-label={label}
			value={typeof value === 'number' ? value : ''}
			oninput={(e) =>
				onchange(e.currentTarget.value === '' ? undefined : Number(e.currentTarget.value))}
		/>{unit}{op === 'more-days-ago' || op === 'fewer-days-ago' ? ' ago' : ''}
	</span>
{:else if operand === 'many'}
	{#if choices}
		<div class="flex flex-wrap gap-1" role="group" aria-label={label}>
			{#each choices as c (c)}
				<button
					type="button"
					aria-pressed={many.includes(c)}
					class={[
						'h-7 cursor-pointer rounded-md border px-2 text-[12px]',
						many.includes(c)
							? 'border-brand-ring bg-brand-soft font-medium text-brand'
							: 'text-muted-foreground hover:text-foreground'
					]}
					onclick={() => toggle(c)}>{c}</button
				>
			{/each}
		</div>
	{:else}
		<input
			type="text"
			class="{box} flex-1"
			aria-label={label}
			placeholder="Values, separated by commas"
			value={many.join(', ')}
			onchange={(e) =>
				onchange(
					e.currentTarget.value
						.split(',')
						.map((s) => s.trim())
						.filter(Boolean)
				)}
		/>
	{/if}
{:else if operand === 'one'}
	{#if kind === 'people' && people}
		<select
			class="{box} flex-1 cursor-pointer"
			aria-label={label}
			value={typeof value === 'string' ? value : ''}
			onchange={(e) => onchange(e.currentTarget.value || undefined)}
		>
			<option value="" disabled>Pick someone</option>
			{#each people as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
			{#if typeof value === 'string' && value && !people.some((p) => p.id === value)}
				<option {value}>{value}</option>
			{/if}
		</select>
	{:else if kind === 'yesno'}
		<div class="flex gap-1" role="radiogroup" aria-label={label}>
			{#each [true, false] as b (b)}
				<button
					type="button"
					role="radio"
					aria-checked={value === b}
					class={[
						'h-8 cursor-pointer rounded-md border px-3 text-[12.5px]',
						value === b
							? 'border-brand-ring bg-brand-soft font-medium text-brand'
							: 'text-muted-foreground hover:text-foreground'
					]}
					onclick={() => onchange(b)}>{b ? 'Yes' : 'No'}</button
				>
			{/each}
		</div>
	{:else if choices}
		<select
			class="{box} flex-1 cursor-pointer"
			aria-label={label}
			value={typeof value === 'string' ? value : ''}
			onchange={(e) => onchange(e.currentTarget.value || undefined)}
		>
			<option value="" disabled>Pick one</option>
			{#each choices as c (c)}<option value={c}>{c}</option>{/each}
		</select>
	{:else if kind === 'date'}
		<span class="flex flex-1 items-center gap-1.5">
			{#if !isToday}
				<input
					type="date"
					class="{box} flex-1"
					aria-label={label}
					value={typeof value === 'string' ? value : ''}
					oninput={(e) => onchange(e.currentTarget.value || undefined)}
				/>
			{/if}
			<button
				type="button"
				aria-pressed={isToday}
				class={[
					'h-8 cursor-pointer rounded-md border px-2 text-[12px] whitespace-nowrap',
					isToday
						? 'border-brand-ring bg-brand-soft font-medium text-brand'
						: 'text-muted-foreground hover:text-foreground'
				]}
				onclick={() => onchange(isToday ? undefined : { today: true })}>Today</button
			>
		</span>
	{:else if kind === 'number'}
		<input
			type="number"
			class="{box} w-28"
			aria-label={label}
			value={typeof value === 'number' ? value : ''}
			oninput={(e) =>
				onchange(e.currentTarget.value === '' ? undefined : Number(e.currentTarget.value))}
		/>
	{:else}
		<input
			type="text"
			class="{box} flex-1"
			aria-label={label}
			placeholder="Value"
			value={typeof value === 'string' ? value : ''}
			oninput={(e) => onchange(e.currentTarget.value === '' ? undefined : e.currentTarget.value)}
		/>
	{/if}
{/if}
