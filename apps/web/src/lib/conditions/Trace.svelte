<script lang="ts">
	// Each part of a tested condition with its answer, nested as the condition is grouped.
	import { describeAst, type FactInfo, type GuardTrace } from '@casebook/model';
	import { CircleCheck, CircleDashed, CircleX, TriangleAlert } from '@lucide/svelte';
	import Trace from './Trace.svelte';

	let { parts, info }: { parts: GuardTrace[]; info: FactInfo } = $props();
	const word = { true: 'yes', false: 'no', unknown: 'not yet', error: 'cannot tell' } as const;
</script>

<ul class="flex flex-col gap-1">
	{#each parts as part, i (i)}
		<li class="flex flex-col gap-1">
			<div class="flex items-start gap-2 text-[12.5px]">
				{#if part.result === 'true'}<CircleCheck
						class="mt-0.5 size-3.5 shrink-0 text-emerald-600"
						aria-label={word.true}
					/>
				{:else if part.result === 'false'}<CircleX
						class="mt-0.5 size-3.5 shrink-0 text-rose-600"
						aria-label={word.false}
					/>
				{:else if part.result === 'unknown'}<CircleDashed
						class="mt-0.5 size-3.5 shrink-0 text-amber-600"
						aria-label={word.unknown}
					/>
				{:else}<TriangleAlert
						class="mt-0.5 size-3.5 shrink-0 text-destructive"
						aria-label={word.error}
					/>{/if}
				<span class={['min-w-0', part.result === 'false' && 'font-medium']}>
					{part.parts.length && part.ast.kind === 'logic'
						? part.ast.op === '&&'
							? 'All of these'
							: 'Any of these'
						: describeAst(part.ast, info)}
					{#if part.result === 'unknown' && part.missing.length}<span class="text-muted-foreground">
							· waiting for {part.missing.map((f) => info(f).name).join(', ')}</span
						>{:else if part.error}<span class="text-destructive"> · {part.error}</span>{/if}
				</span>
			</div>
			{#if part.parts.length && part.ast.kind === 'logic'}
				<div class="ml-1.5 border-l pl-3"><Trace parts={part.parts} {info} /></div>
			{/if}
		</li>
	{/each}
</ul>
