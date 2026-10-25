<script lang="ts" generics="T extends string">
	import type { Component } from 'svelte';
	let {
		value,
		options,
		onchange,
		label
	}: {
		value: T;
		options: { value: T; label: string; icon?: Component<{ class?: string }> }[];
		onchange: (v: T) => void;
		label: string;
	} = $props();
</script>

<div
	role="radiogroup"
	aria-label={label}
	class="inline-flex items-center gap-0.5 rounded-lg bg-muted p-0.5"
>
	{#each options as o (o.value)}
		<button
			role="radio"
			aria-checked={value === o.value}
			class={[
				'inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-[13px] whitespace-nowrap transition-colors',
				value === o.value
					? 'bg-background font-medium text-foreground shadow-xs'
					: 'text-muted-foreground hover:text-foreground'
			]}
			onclick={() => onchange(o.value)}
		>
			{#if o.icon}<o.icon class="size-3.5" />{/if}{o.label}
		</button>
	{/each}
</div>
