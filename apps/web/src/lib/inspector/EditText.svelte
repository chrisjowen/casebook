<script lang="ts">
	// A text field of the definition: plain text when read-only, an input when `onsave` is given.
	// It saves on Enter or when focus leaves, and only when the text changed.
	import Field from './Field.svelte';

	let {
		label,
		value,
		onsave,
		multiline = false,
		placeholder = '',
		hint
	}: {
		label: string;
		value: string | undefined;
		onsave?: (value: string) => void;
		multiline?: boolean;
		placeholder?: string;
		hint?: string;
	} = $props();

	const save = (text: string) => {
		if (text.trim() !== (value ?? '').trim()) onsave?.(text.trim());
	};
	const box =
		'w-full rounded-lg bg-muted/70 px-3 py-2 text-[13px] leading-snug outline-none placeholder:text-muted-foreground focus:bg-background focus:ring-2 focus:ring-brand-ring';
</script>

{#if onsave}
	<label class="flex flex-col gap-1.5">
		<span class="text-[12px] text-muted-foreground">{label}</span>
		{#if multiline}
			<textarea
				class="{box} min-h-[72px] resize-y"
				{value}
				{placeholder}
				onchange={(e) => save(e.currentTarget.value)}></textarea>
		{:else}
			<input
				type="text"
				class="{box} h-9"
				{value}
				{placeholder}
				onchange={(e) => save(e.currentTarget.value)}
				onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
			/>
		{/if}
		{#if hint}<span class="text-[11px] text-muted-foreground">{hint}</span>{/if}
	</label>
{:else if value}
	<Field {label} {hint}>{value}</Field>
{/if}
