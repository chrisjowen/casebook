<script lang="ts">
	// One fact's sample value for a condition test, typed by the fact's kind. Clearing it means the
	// fact is not recorded, which is a real state on a case.
	import type { PersonView } from '@casebook/store';
	import { sampleDay, type FactOption } from './conditions';

	let {
		fact,
		choices,
		people,
		value,
		timeZone,
		onchange
	}: {
		fact: FactOption;
		choices: string[] | undefined;
		/** Who a people fact can hold, once loaded. */
		people?: PersonView[];
		value: unknown;
		/** The zone a date-time's day is read in, as conditions compare it. */
		timeZone: string;
		onchange: (value: unknown) => void;
	} = $props();
	const held = $derived(Array.isArray(value) ? value.map(String) : []);
	const togglePerson = (id: string) => {
		const next = held.includes(id) ? held.filter((p) => p !== id) : [...held, id];
		onchange(next.length ? next : undefined);
	};

	const id = $derived(`sample-${fact.id}`);
	const box =
		'h-8 w-full min-w-0 rounded-md border bg-background px-2 text-[12.5px] outline-none focus:ring-2 focus:ring-brand-ring';
	const text = (v: unknown) =>
		v === undefined || v === null ? '' : Array.isArray(v) ? v.join(', ') : String(v);
	const set = (raw: string, as: (s: string) => unknown = (s) => s) =>
		onchange(raw.trim() === '' ? undefined : as(raw.trim()));
</script>

<div class="flex min-w-0 flex-col gap-1">
	<label for={id} class="flex items-baseline gap-1.5 text-[12px]">
		<span class="truncate font-medium">{fact.name}</span>
		<span class="shrink-0 text-[11px] text-muted-foreground">{fact.type}</span>
	</label>
	{#if fact.kind === 'yesno'}
		<div {id} role="radiogroup" aria-label={fact.name} class="flex gap-1">
			{#each [undefined, true, false] as option (String(option))}
				<button
					type="button"
					role="radio"
					aria-checked={value === option}
					class={[
						'h-8 flex-1 cursor-pointer rounded-md border text-[12px]',
						value === option
							? 'border-brand-ring bg-brand-soft font-medium text-brand'
							: 'text-muted-foreground hover:text-foreground'
					]}
					onclick={() => onchange(option)}
					>{option === undefined ? 'Not recorded' : option ? 'Yes' : 'No'}</button
				>
			{/each}
		</div>
	{:else if choices}
		<select
			{id}
			class="{box} cursor-pointer"
			value={value === undefined ? '' : String(value)}
			onchange={(e) => set(e.currentTarget.value)}
		>
			<option value="">Not recorded</option>
			{#each choices as c (c)}<option value={c}>{c}</option>{/each}
		</select>
	{:else if fact.kind === 'number'}
		<input
			{id}
			type="number"
			class={box}
			placeholder="Not recorded"
			value={text(value)}
			oninput={(e) => set(e.currentTarget.value, Number)}
		/>
	{:else if fact.kind === 'date'}
		<input
			{id}
			type="date"
			class={box}
			value={sampleDay(value, timeZone)}
			oninput={(e) => set(e.currentTarget.value)}
		/>
	{:else if fact.kind === 'people' && people}
		<div {id} role="group" aria-label={fact.name} class="flex flex-wrap gap-1">
			{#each people as p (p.id)}
				<button
					type="button"
					aria-pressed={held.includes(p.id)}
					class={[
						'h-7 cursor-pointer rounded-md border px-2 text-[12px]',
						held.includes(p.id)
							? 'border-brand-ring bg-brand-soft font-medium text-brand'
							: 'text-muted-foreground hover:text-foreground'
					]}
					onclick={() => togglePerson(p.id)}>{p.name}</button
				>
			{/each}
		</div>
	{:else if fact.kind === 'people' || fact.kind === 'list'}
		<input
			{id}
			type="text"
			class={box}
			placeholder="Not recorded · separate with commas"
			value={text(value)}
			onchange={(e) =>
				set(e.currentTarget.value, (s) =>
					s
						.split(',')
						.map((x) => x.trim())
						.filter(Boolean)
				)}
		/>
	{:else if fact.kind === 'document'}
		<label class="flex h-8 cursor-pointer items-center gap-2 text-[12.5px]">
			<input
				{id}
				type="checkbox"
				checked={value !== undefined}
				onchange={(e) => onchange(e.currentTarget.checked ? 'sample-file' : undefined)}
			/>A file is attached
		</label>
	{:else}
		<input
			{id}
			type="text"
			class={box}
			placeholder="Not recorded"
			value={text(value)}
			oninput={(e) => set(e.currentTarget.value)}
		/>
	{/if}
</div>
