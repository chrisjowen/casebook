<script lang="ts">
	// Each part of a tested condition with its answer and the values it read, nested as the
	// condition is grouped: "Amount billed is more than 500 · it is 360".
	import {
		describeAst,
		describeLiteral,
		guardReferences,
		type FactInfo,
		type GuardTrace
	} from '@casebook/model';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import CircleDashed from '@lucide/svelte/icons/circle-dashed';
	import CircleMinus from '@lucide/svelte/icons/circle-minus';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import Trace from './Trace.svelte';

	let {
		parts,
		info,
		values
	}: { parts: GuardTrace[]; info: FactInfo; values: Record<string, unknown> } = $props();

	const word = { true: 'yes', false: 'no', unknown: 'not yet', error: 'cannot tell' } as const;
	/** The recorded values a part read, in words. */
	function read(part: GuardTrace): string {
		const facts = guardReferences(part.text).facts.filter((f) => Object.hasOwn(values, f));
		return facts
			.map((f) => {
				const { name, kind, valueName } = info(f);
				const one = (v: unknown) =>
					valueName && typeof v === 'string' ? valueName(v) : describeLiteral(v, kind);
				const v = values[f];
				const text = Array.isArray(v) ? (v.length ? v.map(one).join(', ') : 'none') : one(v);
				return facts.length === 1 ? `it is ${text}` : `${name} is ${text}`;
			})
			.join('; ');
	}
</script>

<ul class="flex flex-col gap-1">
	{#each parts as part, i (i)}
		{@const group = part.parts.length > 0 && part.ast.kind === 'logic'}
		<li class="flex flex-col gap-1">
			<div class="flex items-start gap-2 text-[12.5px]">
				{#if part.result === 'true'}<CircleCheck
						class="mt-0.5 size-3.5 shrink-0 text-emerald-600"
						aria-label={word.true}
					/>
				{:else if part.result === 'false'}<CircleMinus
						class="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
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
				<span class="min-w-0">
					<span class={part.result === 'false' ? 'font-medium' : ''}
						>{group
							? part.ast.kind === 'logic' && part.ast.op === '&&'
								? 'All of these'
								: 'Any of these'
							: describeAst(part.ast, info)}</span
					>
					{#if part.result === 'unknown' && part.missing.length}<span class="text-muted-foreground">
							· waiting for {part.missing.map((f) => info(f).name).join(', ')}</span
						>{:else if part.error}<span class="text-destructive">
							· {part.error}</span
						>{:else if !group && read(part)}<span class="text-muted-foreground">
							· {read(part)}</span
						>{/if}
				</span>
			</div>
			{#if group}
				<div class="ml-1.5 border-l pl-3"><Trace parts={part.parts} {info} {values} /></div>
			{/if}
		</li>
	{/each}
</ul>
