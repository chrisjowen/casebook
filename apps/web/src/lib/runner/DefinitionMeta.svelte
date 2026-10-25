<script lang="ts">
	// A definition's status, version and change policy in plain words, and whether draft changes
	// are waiting to be published (the full diff stays in the editor). Compact rows name the policy
	// in a word.
	import type { ProcessRow } from '@casebook/store';

	let { process, compact = false }: { process: ProcessRow; compact?: boolean } = $props();
</script>

<span class="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
	{#if process.status === 'published'}
		<span class="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-800"
			>Published · v{process.version}</span
		>
	{:else}
		<span class="rounded-full border border-dashed px-2 py-0.5 font-medium text-foreground/80"
			>Draft · not published</span
		>
	{/if}
	<span>
		{process.policy === 'governed'
			? process.requiresApproval
				? 'Governed · publishing needs approval'
				: compact
					? 'Governed'
					: 'Governed · publish when ready'
			: compact
				? 'Living'
				: 'Living · every edit publishes'}
	</span>
	{#if process.draftPending}
		<span
			class="text-amber-800"
			title="The draft has changes not yet published; the editor shows what changed."
			>Draft changes pending</span
		>
	{/if}
</span>
