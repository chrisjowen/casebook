<script lang="ts">
	// One thing to record, as a field typed from the fact's schema: a file slot for a document, chips
	// for choices and yes/no, people to pick, dates, numbers, lists or text. A value already on the
	// case fills the field, since facts are shared case-wide.
	import { Paperclip, X } from '@lucide/svelte';
	import type { FormField } from '@casebook/store';

	let {
		field,
		error,
		demoFiles = false
	}: {
		field: FormField;
		error?: string;
		/** Offer a made-up document instead of an upload (development only). */
		demoFiles?: boolean;
	} = $props();

	const name = $derived(`value:${field.fact}`);
	const id = $derived(field.fact.replace(/\./g, '-'));
	const current = $derived(field.current?.raw ?? []);
	const input =
		'h-10 rounded-lg border bg-background px-3 text-[14px] outline-none focus:ring-2 focus:ring-brand-ring';

	let fileName = $state('');
	let demo = $state(false);
	let keep = $state(true);
	const shown = $derived(fileName || (demo ? 'A demo document' : ''));
	const choices = $derived(field.kind === 'yesno' ? ['yes', 'no'] : (field.options ?? []));
	const datetime = (raw: string | undefined) => raw?.replace(/:\d{2}(\.\d+)?Z$/, '') ?? '';
</script>

<div class="grid gap-1.5">
	{#if field.kind === 'file'}
		<span class="text-[13px] font-medium" id="{id}-label">{field.title}</span>
		{#if field.hint}<span class="text-[12px] text-muted-foreground">{field.hint}</span>{/if}
		{#if field.current?.file && keep && !shown}
			<div class="flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-[13px]">
				<Paperclip class="size-4 text-muted-foreground" />
				<span class="flex-1 truncate">{field.current.file.name}</span>
				<span class="text-[12px] text-muted-foreground">already on the case</span>
				<button
					type="button"
					class="rounded px-1.5 py-0.5 text-[12px] text-muted-foreground hover:bg-muted"
					onclick={() => (keep = false)}>Replace</button
				>
			</div>
		{/if}
		{#if shown}
			<div class="flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-[13px]">
				<Paperclip class="size-4 text-muted-foreground" />
				<span class="flex-1 truncate">{shown}</span>
				<button
					type="button"
					class="rounded p-0.5 text-muted-foreground hover:bg-muted"
					aria-label="Remove file"
					onclick={() => {
						fileName = '';
						demo = false;
					}}><X class="size-4" /></button
				>
			</div>
		{/if}
		<div
			class={[
				'flex flex-wrap items-center gap-2',
				(shown || (field.current?.file && keep)) && 'hidden'
			]}
		>
			<label
				class="cursor-pointer rounded-lg border border-dashed bg-background px-4 py-3 text-[13px] text-muted-foreground hover:border-foreground/30 hover:text-foreground"
			>
				Choose a file
				<input
					type="file"
					name="file:fact:{field.fact}"
					class="sr-only"
					aria-labelledby="{id}-label"
					onchange={(e) => (fileName = e.currentTarget.files?.[0]?.name ?? '')}
				/>
			</label>
			{#if demoFiles}
				<button
					type="button"
					class="text-[12px] text-muted-foreground underline-offset-2 hover:underline"
					onclick={() => (demo = true)}>or use a demo document</button
				>
			{/if}
		</div>
		{#if demo && !fileName}
			<input type="hidden" name="demo:fact:{field.fact}" value="yes" />
			<input type="hidden" name="demo-name:fact:{field.fact}" value={field.title} />
		{/if}
	{:else if field.kind === 'choice' || field.kind === 'yesno'}
		<fieldset class="grid gap-1.5">
			<legend class="mb-1.5 text-[13px] font-medium">{field.title}</legend>
			{#if field.hint}<span class="-mt-1 text-[12px] text-muted-foreground">{field.hint}</span>{/if}
			<div class="flex flex-wrap gap-2">
				{#each choices as option (option)}
					<label
						class="flex cursor-pointer items-center gap-2 rounded-lg border bg-background px-3 py-2 text-[13px] has-checked:border-brand has-checked:bg-brand-soft"
					>
						<input
							type="radio"
							{name}
							value={option}
							checked={current[0] === option}
							class="accent-brand"
						/>
						{option === 'yes' ? 'Yes' : option === 'no' ? 'No' : option}
					</label>
				{/each}
			</div>
		</fieldset>
	{:else if field.kind === 'people'}
		<fieldset class="grid gap-1.5">
			<legend class="mb-1.5 text-[13px] font-medium">{field.title}</legend>
			{#if field.hint}<span class="-mt-1 text-[12px] text-muted-foreground">{field.hint}</span>{/if}
			<div class="flex flex-wrap gap-2">
				{#each field.people ?? [] as p (p.id)}
					<label
						class="flex cursor-pointer items-center gap-2 rounded-lg border bg-background px-3 py-2 text-[13px] has-checked:border-brand has-checked:bg-brand-soft"
					>
						<input
							type={field.multiple ? 'checkbox' : 'radio'}
							{name}
							value={p.id}
							checked={current.includes(p.id)}
							class="accent-brand"
						/>
						{p.name}
					</label>
				{/each}
			</div>
		</fieldset>
	{:else}
		<label for={id} class="text-[13px] font-medium">{field.title}</label>
		{#if field.hint}<span class="text-[12px] text-muted-foreground">{field.hint}</span>{/if}
		{#if field.kind === 'longtext' || (field.kind === 'text' && !field.example)}
			<textarea
				{id}
				{name}
				rows="3"
				class="rounded-lg border bg-background px-3 py-2 text-[14px] outline-none focus:ring-2 focus:ring-brand-ring"
				>{current[0] ?? ''}</textarea
			>
		{:else if field.kind === 'list' || field.kind === 'json'}
			<textarea
				{id}
				{name}
				rows="3"
				placeholder={field.example ? `e.g. ${field.example}` : ''}
				class="rounded-lg border bg-background px-3 py-2 text-[14px] outline-none focus:ring-2 focus:ring-brand-ring"
				>{field.kind === 'list' ? current.join('\n') : (current[0] ?? '')}</textarea
			>
			{#if field.kind === 'list'}<span class="text-[12px] text-muted-foreground">One per line.</span
				>{/if}
		{:else}
			<div class="flex items-center gap-2">
				{#if field.currency}<span class="text-[14px] text-muted-foreground">{field.currency}</span
					>{/if}
				<input
					{id}
					{name}
					type={field.kind === 'number'
						? 'number'
						: field.kind === 'date'
							? 'date'
							: field.kind === 'datetime'
								? 'datetime-local'
								: 'text'}
					step={field.kind === 'number' ? 'any' : undefined}
					value={field.kind === 'datetime' ? datetime(current[0]) : (current[0] ?? '')}
					placeholder={field.example ? `e.g. ${field.example}` : ''}
					class={[input, 'min-w-0 flex-1']}
				/>
			</div>
			{#if field.kind === 'datetime'}<span class="text-[12px] text-muted-foreground">In UTC.</span
				>{/if}
		{/if}
	{/if}
	{#if field.evidence}
		<label class="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
			<span
				>Attach {field.evidence.description.charAt(0).toLowerCase() +
					field.evidence.description.slice(1)}{#if field.evidence.formats.length}
					({field.evidence.formats.join(' or ')}){/if}:</span
			>
			<input type="file" name="file:fact:{field.fact}" class="text-[12px]" />
		</label>
	{/if}
	{#if error}<p class="text-[12px] font-medium text-destructive" role="alert">{error}</p>{/if}
</div>
