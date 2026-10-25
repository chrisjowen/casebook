<script lang="ts">
	// The task's process as a task list, one group per stage: where this task sits, what is done,
	// what is yours, and what comes after. Every item opens; others' items open read-only.
	import { Check, CircleDot, CircleAlert, Hourglass, Lock, CircleSlash } from '@lucide/svelte';
	import type { ResolvedPathname } from '$app/types';
	import type { OutlineStage } from '@casebook/store';

	let {
		stages,
		current,
		href
	}: {
		stages: OutlineStage[];
		/** The open task's item id. */
		current: string;
		href: (item: string) => ResolvedPathname;
	} = $props();

	const settled = (status: string) => status === 'done' || status === 'skipped';
	const word: Record<string, string> = {
		done: 'Done',
		skipped: 'Not needed',
		ready: 'Ready',
		held: 'Paused',
		waiting: 'Waiting',
		blocked: 'Missing information',
		upcoming: 'Later'
	};
</script>

<ol class="grid gap-4">
	{#each stages as stage, i (stage.id)}
		<li>
			<p
				class={[
					'mb-1 flex items-center gap-1.5 px-2 text-[12px]',
					stage.state === 'current' ? 'font-semibold text-foreground' : 'text-muted-foreground'
				]}
			>
				<span class="tabular-nums">{i + 1}.</span>
				<span class="truncate">{stage.title}</span>
				{#if stage.state === 'done'}<Check class="size-3 shrink-0" aria-label="Stage done" />{/if}
			</p>
			<ul class="grid gap-px">
				{#each stage.items as item (item.id)}
					{@const here = item.id === current}
					<li>
						<a
							href={href(item.id)}
							aria-current={here ? 'page' : undefined}
							class={[
								'flex items-start gap-2 rounded-md px-2 py-1.5 text-[13px] leading-snug',
								here ? 'bg-brand-soft text-foreground' : 'hover:bg-muted',
								!here &&
									(item.status === 'done' || item.status === 'skipped') &&
									'text-muted-foreground',
								!here && item.status === 'upcoming' && 'text-muted-foreground/80'
							]}
						>
							<span class="mt-0.5 shrink-0" aria-hidden="true">
								{#if item.status === 'done'}<Check class="size-3.5 text-emerald-600" />
								{:else if item.status === 'skipped'}<CircleSlash class="size-3.5" />
								{:else if item.status === 'ready'}<CircleDot class="size-3.5 text-brand" />
								{:else if item.status === 'held' || item.status === 'blocked'}<CircleAlert
										class="size-3.5 text-amber-700"
									/>
								{:else if item.status === 'waiting'}<Hourglass class="size-3.5" />
								{:else}<Lock class="size-3.5" />{/if}
							</span>
							<span class="min-w-0 flex-1">
								<span class={[here && 'font-medium']}>{item.title}</span>
								<span class="block text-[11.5px] text-muted-foreground"
									>{[
										word[item.status],
										settled(item.status)
											? ''
											: item.mine
												? 'yours'
												: item.holders.map((h) => h.name).join(', ')
									]
										.filter(Boolean)
										.join(' · ')}</span
								>
							</span>
						</a>
					</li>
				{/each}
			</ul>
		</li>
	{/each}
</ol>
