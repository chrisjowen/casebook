<script lang="ts">
	// A process's actions at the right of the top bar on each of its tabs: Start a case when it
	// can run, and its "…" menu with every verb.
	import Play from '@lucide/svelte/icons/play';
	import { links } from '$lib/runner/links';
	import ActionsMenu from './ActionsMenu.svelte';
	import { processVerbs, type ProcessTarget } from './actions';

	let {
		instance,
		process,
		title,
		omit = []
	}: { instance: string; process: ProcessTarget; title: string; omit?: string[] } = $props();
</script>

{#if process.canStart?.allowed}
	<a
		href={links.newCase(instance, { process: process.slug })}
		class="flex h-8 items-center gap-1.5 rounded-lg bg-foreground px-3 text-[13px] font-medium text-background hover:bg-foreground/90"
		><Play class="size-3.5" />Start a case</a
	>
{/if}
<ActionsMenu verbs={processVerbs(instance, process)} label={title} {omit} size="sm" />
