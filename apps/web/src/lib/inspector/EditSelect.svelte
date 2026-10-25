<script lang="ts">
	// A choice field of the definition: plain text when read-only, a select when `onsave` is given.
	import type { Snippet } from 'svelte';
	import Field from './Field.svelte';

	let {
		label,
		value,
		options,
		onsave,
		children
	}: {
		label: string;
		value: string;
		options: { value: string; label: string }[];
		onsave?: (value: string) => Promise<boolean>;
		/** How the value reads when read-only; defaults to its option label. */
		children?: Snippet;
	} = $props();
</script>

{#if onsave}
	<label class="flex flex-col gap-1.5">
		<span class="text-[12px] text-muted-foreground">{label}</span>
		<select
			class="h-9 w-full cursor-pointer rounded-lg bg-muted/70 px-2.5 text-[13px] outline-none focus:ring-2 focus:ring-brand-ring"
			{value}
			onchange={async (e) => {
				const field = e.currentTarget;
				if (field.value !== value && !(await onsave(field.value))) field.value = value;
			}}
		>
			{#each options as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
		</select>
	</label>
{:else}
	<Field {label}
		>{#if children}{@render children()}{:else}{options.find((o) => o.value === value)?.label ??
				value}{/if}</Field
	>
{/if}
