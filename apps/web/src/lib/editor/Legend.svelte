<script lang="ts">
	import {
		ShieldCheck,
		Split,
		Sparkles,
		Repeat,
		Bot,
		Signpost,
		TriangleAlert,
		Info,
		X,
		UserPlus
	} from '@lucide/svelte';
	let { facts = false }: { facts?: boolean } = $props();
	let open = $state(false);
	const items = [
		[Split, 'Only runs when a condition holds'],
		[Repeat, 'Repeats until a condition holds'],
		[Signpost, 'Decision'],
		[ShieldCheck, 'Needs approval'],
		[UserPlus, 'Assigns people to a role'],
		[Bot, 'An agent can do or help with it'],
		[Sparkles, 'Inferred, not stated in the source'],
		[TriangleAlert, 'Needs a fact nothing collects']
	] as const;
</script>

{#if open}
	<div class="w-64 rounded-xl border bg-card p-3 text-[12px] shadow-sm">
		<div class="mb-2 flex items-center justify-between font-medium">
			Key<button
				class="cursor-pointer text-muted-foreground hover:text-foreground"
				onclick={() => (open = false)}
				aria-label="Close key"><X class="size-3.5" /></button
			>
		</div>
		<ul class="flex flex-col gap-1.5 text-muted-foreground">
			{#each items as [Icon, label] (label)}<li class="flex items-center gap-2">
					<Icon class="size-3.5" />{label}
				</li>{/each}
			<li class="mt-1 border-t pt-2">
				{facts
					? 'Lines run from a step to the facts it collects, and from facts to the steps that need them.'
					: 'Lines run from the fact a step collects to the step that needs it. Hover a line to see the facts.'}
			</li>
		</ul>
	</div>
{:else}
	<button
		class="flex cursor-pointer items-center gap-1.5 rounded-lg border bg-card px-2.5 py-1.5 text-[12px] text-muted-foreground shadow-xs hover:text-foreground"
		onclick={() => (open = true)}
	>
		<Info class="size-3.5" />Key
	</button>
{/if}
