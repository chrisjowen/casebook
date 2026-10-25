<script lang="ts">
	// The values of a lookup, edited in place (ADR 0025): rename a value, give it a code and say
	// what it means in its row, turn it off so it is no longer offered, take it out, drag it (or
	// move it with the arrow keys on its handle) to reorder, and type or paste to add. Pasting a list
	// adds one value per line, and `Label<TAB>Code` lines copied from a spreadsheet bring their
	// codes. Every change goes through `onchange`, which saves it the way the list is kept; without
	// it the list is read-only. `simple` is for a fact's own options, which are only names.
	import {
		addValues,
		labelOfValue,
		moveValue,
		readValueLines,
		relabelValue,
		removeValue,
		setValueCode,
		setValueDescription,
		setValueDisabled,
		sortValues,
		type LookupValue,
		type ValuesEdit
	} from '@casebook/model';
	import { ArrowDownAZ, GripVertical, Plus, Search, X } from '@lucide/svelte';

	let {
		values,
		onchange,
		dense = false,
		simple = false,
		confirmRemove
	}: {
		values: LookupValue[];
		/** Saves the new values, or shows why not; resolves whether it was saved. */
		onchange?: (next: ValuesEdit) => Promise<boolean>;
		/** A compact list, as under a fact in a step's Records. */
		dense?: boolean;
		/** Names only: no codes, meanings or turning off, as a fact's own options. */
		simple?: boolean;
		/** Asks before a value is taken out; resolves whether to go ahead. */
		confirmRemove?: (v: LookupValue) => boolean;
	} = $props();

	let adding = $state('');
	let filter = $state('');
	let note = $state('');
	let dragging = $state<string | undefined>();
	let over = $state<number | undefined>();
	const off = $derived(values.filter((v) => v.disabled).length);
	const searchable = $derived(values.length > 12);
	const shown = $derived(
		filter.trim()
			? values.filter((v) =>
					[labelOfValue(v), v.code ?? '', v.value, v.description ?? ''].some((t) =>
						t.toLowerCase().includes(filter.trim().toLowerCase())
					)
				)
			: values
	);

	const save = (next: ValuesEdit) => onchange?.(next) ?? Promise.resolve(false);

	async function add(text: string) {
		const items = readValueLines(text);
		if (items.length === 0) return;
		const next = addValues(values, items);
		const skipped = typeof next === 'string' ? 0 : items.length - (next.length - values.length);
		if (await save(next)) {
			adding = '';
			note = skipped ? `${skipped} already in the list, so skipped` : '';
		}
	}
	async function relabel(v: LookupValue, field: HTMLInputElement) {
		const text = field.value.trim();
		if (text === labelOfValue(v)) return;
		if (!(await save(relabelValue(values, v.value, text)))) field.value = labelOfValue(v);
	}
	async function recode(v: LookupValue, field: HTMLInputElement) {
		const text = field.value.trim();
		if (text === (v.code ?? '')) return;
		if (!(await save(setValueCode(values, v.value, text)))) field.value = v.code ?? '';
	}
	async function describe(v: LookupValue, field: HTMLInputElement) {
		const text = field.value.trim();
		if (text === (v.description ?? '')) return;
		if (!(await save(setValueDescription(values, v.value, text))))
			field.value = v.description ?? '';
	}
	function remove(v: LookupValue) {
		if (confirmRemove && !confirmRemove(v)) return;
		void save(removeValue(values, v.value));
	}
	function moveBy(v: LookupValue, by: -1 | 1) {
		const at = values.indexOf(v) + by;
		if (at >= 0 && at < values.length) void save(moveValue(values, v.value, at));
	}
	function drop(at: number) {
		const from = dragging;
		dragging = undefined;
		over = undefined;
		if (from === undefined) return;
		const index = values.findIndex((v) => v.value === from);
		const to = index < at ? at - 1 : at;
		if (to !== index) void save(moveValue(values, from, to));
	}
	const enter = (e: KeyboardEvent) => {
		e.stopPropagation();
		if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
	};
	const cell =
		'min-w-0 rounded-md bg-transparent px-1.5 outline-none hover:bg-muted/60 focus:bg-background focus:ring-2 focus:ring-brand-ring';
	// Row actions stay quiet until the row is pointed at or focused, where a pointer can hover.
	const quiet =
		'[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100';
</script>

{#snippet addRow()}
	<label
		class="flex items-center gap-1.5 rounded-lg border border-dashed px-2 focus-within:border-solid focus-within:border-brand-ring"
	>
		<Plus class="size-3.5 shrink-0 text-muted-foreground" />
		<input
			class="h-8 min-w-0 flex-1 bg-transparent px-1 text-[13px] outline-none placeholder:text-muted-foreground"
			placeholder={values.length ? 'Add a value, then Enter' : 'Add values: type, or paste a list'}
			aria-label="Add a value"
			title="Separate several with commas, or paste one per line. A spreadsheet's name and code columns paste as both."
			bind:value={adding}
			onkeydown={(e) => {
				e.stopPropagation();
				if (e.key === 'Enter') {
					e.preventDefault();
					void add(adding);
				}
				if (e.key === 'Escape') (e.currentTarget as HTMLInputElement).blur();
			}}
			onpaste={(e) => {
				const text = e.clipboardData?.getData('text/plain') ?? '';
				if (!/[\n\t]/.test(text.trim())) return;
				e.preventDefault();
				void add(text);
			}}
		/>
	</label>
	{#if note}<p class="px-1 text-[11.5px] text-muted-foreground" role="status">{note}</p>{/if}
{/snippet}

<div class="flex flex-col gap-1.5">
	{#if !dense || searchable}
		<div class="flex items-center gap-2 text-[11.5px] text-muted-foreground">
			<span class="tabular-nums"
				>{filter.trim() ? `${shown.length} of ${values.length}` : values.length}
				{values.length === 1 ? 'value' : 'values'}{off ? ` · ${off} turned off` : ''}</span
			>
			{#if searchable}
				<label
					class="ml-auto flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md bg-muted/70 px-2 focus-within:ring-2 focus-within:ring-brand-ring sm:max-w-48"
				>
					<Search class="size-3.5 shrink-0" />
					<input
						class="min-w-0 flex-1 bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground"
						placeholder="Find a value"
						aria-label="Find a value"
						bind:value={filter}
						onkeydown={(e) => e.stopPropagation()}
					/>
				</label>
			{/if}
			{#if onchange && values.length > 1}
				<button
					class={[
						'inline-flex h-7 cursor-pointer items-center gap-1 rounded-md px-1.5 hover:bg-muted hover:text-foreground',
						!searchable && 'ml-auto'
					]}
					title="Sort A to Z, turned-off values last"
					onclick={() => save(sortValues(values))}><ArrowDownAZ class="size-3.5" />Sort</button
				>
			{/if}
		</div>
	{/if}

	{#if onchange && searchable}{@render addRow()}{/if}

	<ul class={['flex flex-col', dense ? 'gap-0.5' : 'gap-1']} aria-label="Values">
		{#each shown as v, i (v.value)}
			{@const label = labelOfValue(v)}
			<li
				class={[
					'group flex flex-wrap items-start gap-x-1 rounded-lg border bg-background py-0.5 pr-0.5 pl-0.5',
					v.disabled && 'bg-muted/40',
					dragging === v.value && 'opacity-50',
					over === i && dragging !== undefined && 'border-t-2 border-t-brand'
				]}
				draggable={!!onchange && !filter}
				ondragstart={(e) => {
					dragging = v.value;
					e.dataTransfer?.setData('text/plain', v.value);
				}}
				ondragover={(e) => {
					if (dragging === undefined) return;
					e.preventDefault();
					over = i;
				}}
				ondragend={() => {
					dragging = undefined;
					over = undefined;
				}}
				ondrop={(e) => {
					e.preventDefault();
					drop(i);
				}}
			>
				{#if onchange && !filter}
					<button
						class="flex size-7 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground/60 hover:bg-muted hover:text-foreground active:cursor-grabbing"
						aria-label="Move {label}: use the up and down arrow keys"
						title="Drag to reorder"
						onkeydown={(e) => {
							e.stopPropagation();
							if (e.key === 'ArrowUp') {
								e.preventDefault();
								moveBy(v, -1);
							} else if (e.key === 'ArrowDown') {
								e.preventDefault();
								moveBy(v, 1);
							}
						}}><GripVertical class="size-3.5" /></button
					>
				{:else}
					<span class="w-1.5"></span>
				{/if}
				<div class="min-w-0 flex-1">
					{#if onchange}
						<input
							class={[cell, 'h-7 w-full text-[13px]', v.disabled && 'text-muted-foreground']}
							value={label}
							aria-label="Name of {label}"
							title={label === v.value ? 'Click to rename' : `Cases store this as “${v.value}”`}
							onchange={(e) => relabel(v, e.currentTarget)}
							onkeydown={enter}
						/>
					{:else}
						<span
							class={[
								'block truncate px-1.5 py-1 text-[13px]',
								v.disabled && 'text-muted-foreground'
							]}>{label}</span
						>
					{/if}
				</div>
				{#if onchange && !simple}
					<input
						class={[
							cell,
							'h-7 w-16 font-mono text-[11.5px] text-muted-foreground sm:w-20',
							!v.code && quiet
						]}
						value={v.code ?? ''}
						placeholder="Code"
						aria-label="Code of {label}"
						title="An optional short code, such as GB"
						onchange={(e) => recode(v, e.currentTarget)}
						onkeydown={enter}
					/>
				{:else if v.code}<span class="px-1.5 py-1 font-mono text-[11.5px] text-muted-foreground"
						>{v.code}</span
					>{/if}
				{#if onchange && !simple}
					<button
						class={[
							'h-7 shrink-0 cursor-pointer rounded-md px-1.5 text-[11.5px] hover:bg-muted',
							v.disabled ? 'font-medium text-muted-foreground' : ['text-muted-foreground', quiet]
						]}
						aria-label={v.disabled ? `Turn ${label} back on` : `Turn ${label} off`}
						title={v.disabled
							? 'Offer it again'
							: 'Stop offering it; cases that already hold it keep it'}
						onclick={() => save(setValueDisabled(values, v.value, !v.disabled))}
						>{v.disabled ? 'Off · turn on' : 'Turn off'}</button
					>
				{:else if v.disabled}
					<span
						class="mt-1 shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10.5px] font-medium text-muted-foreground"
						>Off</span
					>
				{/if}
				{#if onchange}
					<button
						class={[
							'flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-destructive',
							quiet
						]}
						aria-label="Remove {label}"
						title={simple
							? 'Take it out of the options'
							: 'Take it out of the list. To keep it on cases that hold it, turn it off instead.'}
						onclick={() => remove(v)}><X class="size-3.5" /></button
					>
				{/if}
				{#if onchange && !simple}
					<input
						class={[
							cell,
							'mb-0.5 ml-8 h-6 w-[calc(100%-2.5rem)] text-[11.5px] text-muted-foreground',
							!v.description && 'hidden group-focus-within:block'
						]}
						value={v.description ?? ''}
						placeholder="What it means (optional)"
						aria-label="What {label} means"
						onchange={(e) => describe(v, e.currentTarget)}
						onkeydown={enter}
					/>
				{:else if v.description}
					<span class="mb-1 ml-8 w-[calc(100%-2.5rem)] text-[11.5px] text-muted-foreground"
						>{v.description}</span
					>
				{/if}
			</li>
		{:else}
			<li class="px-1 text-[12px] text-muted-foreground">
				{filter ? 'No value matches.' : 'No values yet.'}
			</li>
		{/each}
		{#if onchange && !filter && dragging !== undefined}
			<li
				class={['h-3 rounded', over === values.length && 'border-t-2 border-t-brand']}
				ondragover={(e) => {
					e.preventDefault();
					over = values.length;
				}}
				ondrop={(e) => {
					e.preventDefault();
					drop(values.length);
				}}
			></li>
		{/if}
	</ul>

	{#if onchange && !searchable}{@render addRow()}{/if}
</div>
