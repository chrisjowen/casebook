<script lang="ts">
	import BadgeCheck from '@lucide/svelte/icons/badge-check';
	import CircleDot from '@lucide/svelte/icons/circle-dot';
	import Split from '@lucide/svelte/icons/split';
	import type { WorkItemKind } from '@casebook/model';

	let { kind }: { kind: WorkItemKind } = $props();
	const label = $derived({ step: 'Task', decision: 'Decision', approval: 'Approval' }[kind]);
</script>

<span
	class="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"
	title={label}
>
	{#if kind === 'decision'}<Split class="size-4" aria-label={label} />
	{:else if kind === 'approval'}<BadgeCheck class="size-4" aria-label={label} />
	{:else}<CircleDot class="size-4" aria-label={label} />{/if}
</span>
