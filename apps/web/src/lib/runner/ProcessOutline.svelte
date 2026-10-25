<script lang="ts">
	// The read-only whole process: stages in order and the work in each, with who does it, its
	// condition, what it uses and records. Given a case's item states, it marks done and current
	// stages and each item's status there. A list, not the editor's graph.
	import { Check } from '@lucide/svelte';
	import { runnableProcess, type DefinitionDocument, type StageState } from '@casebook/model';
	import type { ItemBrief } from '@casebook/store';
	import ItemIcon from './ItemIcon.svelte';
	import StatusTag from './StatusTag.svelte';
	import { lowerFirst, onlyWhen } from './format';

	let {
		document,
		stages,
		items,
		authoring = false
	}: {
		document: DefinitionDocument;
		/** The stages' states on a case, when shown for one. */
		stages?: StageState[];
		/** The items' states on a case, when shown for one. */
		items?: ItemBrief[];
		/** Authors also see who may do each step: a person, an agent or either. */
		authoring?: boolean;
	} = $props();

	const process = $derived(runnableProcess(document));
	const factTitle = (id: string) => process.facts.get(id)?.core.title ?? id;
	const roleTitle = (id: string) => process.roles.get(id)?.title ?? id;
</script>

{#if !process.stages.length}
	<p
		class="mt-6 rounded-xl border border-dashed bg-card px-5 py-8 text-center text-[13px] text-muted-foreground"
	>
		No stages yet. Open the editor to add stages, steps and facts.
	</p>
{/if}
<ol class="mt-6 grid gap-6">
	{#each process.stages as stage, si (stage.id)}
		{@const state = stages?.[si]?.state}
		<li>
			<div class="mb-2 flex items-center gap-2 px-1">
				<span
					class={[
						'grid size-6 place-items-center rounded-full text-[11px] font-semibold',
						state === 'current'
							? 'bg-brand text-white'
							: state === 'done'
								? 'bg-brand/15 text-brand'
								: 'bg-muted text-muted-foreground'
					]}
					>{#if state === 'done'}<Check class="size-3.5" />{:else}{si + 1}{/if}</span
				>
				<h2 class="text-[15px] font-semibold">{stage.title}</h2>
				{#if state === 'current'}<span class="text-[12px] text-brand">Current stage</span>{/if}
			</div>
			<ul class="divide-y rounded-xl border bg-card">
				{#each process.items.filter((i) => i.stage === stage.id) as item (item.id)}
					{@const brief = items?.find((x) => x.id === item.id)}
					<li class="flex gap-3 px-4 py-3.5">
						<ItemIcon kind={item.kind} />
						<div class="min-w-0 flex-1 text-[13px]">
							<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
								<span class="text-[14px] font-medium">{item.title}</span>
								{#if brief}
									<StatusTag task={{ status: brief.status, repeating: !!item.repeat }} />
								{/if}
							</div>
							<p class="mt-0.5 text-muted-foreground">
								{roleTitle(item.role)}{#if brief?.holders.length}
									({brief.holders.map((h) => h.name).join(', ')}){/if}
								{#if authoring}
									· {item.actor === 'human'
										? 'a person only'
										: item.actor === 'agent'
											? 'done by an agent'
											: 'a person or an agent'}
								{/if}
							</p>
							{#if brief?.done && brief.status === 'done'}
								<p class="mt-1 text-muted-foreground">Done by {brief.done.by.name}</p>
							{/if}
							{#if brief?.skipped}
								<p class="mt-1 text-muted-foreground">
									Skipped by {brief.skipped.by.name}: “{brief.skipped.reason}”
								</p>
							{:else if brief?.status === 'skipped'}
								<p class="mt-1 text-muted-foreground">Not needed on this case</p>
							{/if}
							{#if item.when?.text}
								<p class="mt-1 text-muted-foreground">{onlyWhen(item.when.text)}</p>
							{/if}
							{#if item.repeat}
								<p class="mt-1 text-muted-foreground">
									Repeats {lowerFirst(item.repeat.until.text)}
								</p>
							{/if}
							{#if item.reviews}
								<p class="mt-1 text-muted-foreground">
									Reviews “{process.items.find((x) => x.id === item.reviews)?.title}”
								</p>
							{/if}
							{#if item.requires.length || item.collects.length}
								<dl class="mt-2 grid gap-1 sm:grid-cols-[5rem_minmax(0,1fr)]">
									{#if item.requires.length}
										<dt class="text-muted-foreground">Uses</dt>
										<dd>{item.requires.map(factTitle).join(', ')}</dd>
									{/if}
									{#if item.collects.length}
										<dt class="text-muted-foreground">Records</dt>
										<dd>{item.collects.map((col) => factTitle(col.fact)).join(', ')}</dd>
									{/if}
								</dl>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
		</li>
	{/each}
</ol>
