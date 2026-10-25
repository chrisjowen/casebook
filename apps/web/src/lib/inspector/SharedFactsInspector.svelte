<script lang="ts">
	import type { SharedFactType } from '$lib/graph/derive';
	import Group from './Group.svelte';
	let { shared }: { shared: SharedFactType[] } = $props();
</script>

<div class="flex flex-col">
	<p class="px-5 pt-4 pb-4 text-[12.5px] leading-relaxed text-muted-foreground">
		Fact types declared by more than one process in this workspace. A case records each once and
		every process reuses it.
	</p>
	{#each shared as fact (fact.id)}
		<Group title={fact.title}>
			<ul class="flex flex-col divide-y rounded-lg border">
				{#each fact.uses as use (use.slug)}
					<li class="px-3 py-2 text-[12.5px]">
						<div class="font-medium">{use.process}</div>
						<div class="text-[11px] text-muted-foreground">
							{use.collectedBy.length
								? `Collected by ${use.collectedBy.join(', ')}`
								: 'Not collected here'}{use.neededBy.length
								? ` · needed by ${use.neededBy.join(', ')}`
								: ''}
						</div>
					</li>
				{/each}
			</ul>
		</Group>
	{:else}
		<p class="border-t px-5 py-4 text-[12.5px] text-muted-foreground">
			No fact types are shared between processes in this workspace yet.
		</p>
	{/each}
</div>
