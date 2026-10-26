<script lang="ts">
	// A process's stages only, never the full flow: done stages pale, the current one solid.
	import Check from '@lucide/svelte/icons/check';
	import type { StageState } from '@casebook/model';

	let {
		stages,
		size = 'full'
	}: {
		stages: StageState[];
		/** `full` labels every stage; `mini` is one line for lists. */
		size?: 'full' | 'mini';
	} = $props();

	const currentIndex = $derived(stages.findIndex((s) => s.state === 'current'));
	const complete = $derived(currentIndex === -1);
</script>

{#if size === 'mini'}
	<span class="inline-flex min-w-0 items-center gap-2 text-[12px] text-muted-foreground">
		<span class="flex shrink-0 gap-0.5" aria-hidden="true">
			{#each stages as stage (stage.id)}
				<span
					class={[
						'h-1 w-3.5 rounded-full',
						stage.state === 'done' && 'bg-brand/30',
						stage.state === 'current' && 'bg-brand',
						stage.state === 'upcoming' && 'bg-border'
					]}
				></span>
			{/each}
		</span>
		<span class="truncate">
			{#if complete}
				Finished
			{:else}
				Stage {currentIndex + 1} of {stages.length} · {stages[currentIndex]?.title}
			{/if}
		</span>
	</span>
{:else}
	<ol class="grid gap-1.5" style="grid-template-columns: repeat({stages.length}, minmax(0, 1fr))">
		{#each stages as stage (stage.id)}
			<li class="min-w-0" aria-current={stage.state === 'current' ? 'step' : undefined}>
				<span
					class={[
						'block h-1.5 rounded-full',
						stage.state === 'done' && 'bg-brand/30',
						stage.state === 'current' && 'bg-brand',
						stage.state === 'upcoming' && 'bg-border'
					]}
				></span>
				<span
					class={[
						'mt-1.5 flex items-center gap-1 text-[12px] leading-tight',
						stage.state === 'current' && 'font-medium text-foreground',
						stage.state === 'done' && 'text-muted-foreground',
						stage.state === 'upcoming' && 'text-muted-foreground/70'
					]}
				>
					{#if stage.state === 'done'}<Check class="size-3 shrink-0" aria-label="Done" />{/if}
					<span class="truncate">{stage.title}</span>
				</span>
			</li>
		{/each}
	</ol>
{/if}
