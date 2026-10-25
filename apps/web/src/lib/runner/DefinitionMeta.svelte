<script lang="ts">
	// A definition's status, version and change policy in plain words, and whether draft changes
	// are waiting to be published (the full diff stays in the editor).
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
	{#if !compact}
		<span>
			{process.policy === 'governed'
				? process.requiresApproval
					? 'Governed · publishing needs approval'
					: 'Governed · publish when ready'
				: 'Living · every edit publishes'}
		</span>
	{/if}
	{#if process.draftPending}
		<span class="text-amber-800">· Draft changes pending</span>
	{/if}
</span>
