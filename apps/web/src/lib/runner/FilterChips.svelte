<script lang="ts">
	// Process filter chips: narrow a list to one process, kept in the URL.
	import { page } from '$app/state';
	import { links } from './links';

	let { options }: { options: { value: string; label: string }[] } = $props();

	const active = $derived(page.url.searchParams.get('process') ?? '');
</script>

{#if options.length > 1}
	<div class="flex flex-wrap gap-1.5" role="group" aria-label="Filter by process">
		{#each [{ value: '', label: 'All processes' }, ...options] as option (option.value)}
			<a
				href={links.here(page.url, { process: option.value, saved: undefined })}
				data-sveltekit-noscroll
				class={[
					'rounded-full border px-3 py-1 text-[12px] transition-colors',
					active === option.value
						? 'border-foreground bg-foreground text-background'
						: 'bg-background text-muted-foreground hover:text-foreground'
				]}
				aria-current={active === option.value ? 'true' : undefined}>{option.label}</a
			>
		{/each}
	</div>
{/if}
