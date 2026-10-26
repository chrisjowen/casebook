<script lang="ts">
	import type { Snippet } from 'svelte';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CircleCheck from '@lucide/svelte/icons/circle-check';

	let { tone = 'done', children }: { tone?: 'done' | 'problem'; children: Snippet } = $props();
</script>

<div
	class={[
		'mb-6 flex items-start gap-2 rounded-xl border px-4 py-3 text-[13px]',
		tone === 'problem' ? 'border-destructive/30 bg-destructive/5' : 'bg-card'
	]}
	role={tone === 'problem' ? 'alert' : 'status'}
>
	{#if tone === 'problem'}
		<CircleAlert class="mt-0.5 size-4 shrink-0 text-destructive" />
	{:else}
		<CircleCheck class="mt-0.5 size-4 shrink-0 text-emerald-600" />
	{/if}
	<div class="min-w-0 flex-1">{@render children()}</div>
</div>
