<script lang="ts">
	// Process summary with the model's publish checks in plain language.
	import { labelOf, plainText, type ProcessIndex } from '$lib/graph/derive';
	import type { LoadedDefinition } from '$lib/definitions/types';
	import { toneBar } from '$lib/graph/tones';
	import Field from './Field.svelte';
	import Group from './Group.svelte';
	import { CircleCheck, CircleAlert, TriangleAlert } from '@lucide/svelte';

	let { ix, loaded }: { ix: ProcessIndex; loaded: LoadedDefinition } = $props();
	const errors = $derived(loaded.issues.filter((i) => i.severity === 'error'));
	const warnings = $derived(loaded.issues.filter((i) => i.severity === 'warning'));
	const counts = $derived([
		[ix.work.length, 'Steps and decisions'],
		[ix.stages.length, 'Stages'],
		[ix.facts.length, 'Fact types']
	] as const);
</script>

<div class="flex flex-col">
	<div class="flex flex-col gap-3.5 px-5 pt-4 pb-5">
		<Field label="Process">{labelOf(ix, ix.process?.core.id)}</Field>
		{#if ix.process?.content}<Field label="Purpose">{ix.process.content}</Field>{/if}
		<div class="grid grid-cols-2 gap-3">
			<Field label="Version">{ix.document.version}</Field>
			<Field label="Owner">{ix.document.namespace.replaceAll('/', ' / ')}</Field>
		</div>
		{#if ix.process?.core.source}<Field label="Taken from">{ix.process.core.source.doc}</Field>{/if}
		<div class="grid grid-cols-3 gap-2 text-center">
			{#each counts as [n, label] (label)}
				<div class="rounded-lg bg-muted/70 py-2">
					<div class="text-[16px] font-semibold">{n}</div>
					<div class="text-[11px] leading-tight text-muted-foreground">{label}</div>
				</div>
			{/each}
		</div>
	</div>

	<Group title="Publish checks">
		{#if loaded.errors.length}
			<p class="flex items-start gap-2 text-[12.5px] font-medium">
				<CircleAlert class="mt-0.5 size-3.5 shrink-0 text-destructive" />The definition does not
				match the schema, so the other checks did not run.
			</p>
			<ul class="flex flex-col gap-1.5 pl-5.5 text-[12px] text-muted-foreground">
				{#each loaded.errors as e (e.path + e.keyword)}<li>{plainText(ix, e.message)}</li>{/each}
			</ul>
		{:else if loaded.ok && !warnings.length}
			<p class="flex items-center gap-2 text-[12.5px]">
				<CircleCheck class="size-3.5 text-emerald-600" />All checks pass. This version can be
				published.
			</p>
		{:else}
			<p class="flex items-center gap-2 text-[12.5px] font-medium">
				{#if errors.length}<CircleAlert class="size-3.5 text-destructive" />{errors.length}
					{errors.length === 1 ? 'problem blocks' : 'problems block'} publishing
				{:else}<CircleCheck class="size-3.5 text-emerald-600" />Can be published, with {warnings.length}
					{warnings.length === 1 ? 'warning' : 'warnings'}{/if}
			</p>
			<ul class="flex flex-col gap-2">
				{#each [...errors, ...warnings] as issue (issue.path + issue.code)}
					<li class="flex items-start gap-2 text-[12.5px]">
						{#if issue.severity === 'error'}<CircleAlert
								class="mt-0.5 size-3.5 shrink-0 text-destructive"
							/>{:else}<TriangleAlert class="mt-0.5 size-3.5 shrink-0 text-amber-600" />{/if}
						<span>{plainText(ix, issue.message)}</span>
					</li>
				{/each}
			</ul>
		{/if}
	</Group>

	<Group title="Roles" count={ix.roles.length}>
		{#each ix.roles as role, i (role.core.id)}
			<div class="flex items-center gap-2 text-[12.5px]">
				<span class={['size-2 rounded-full', toneBar[i % 6]]}></span>{labelOf(ix, role.core.id)}
				{#if role.core.scope === 'case'}<span class="text-[11px] text-muted-foreground"
						>assigned per case</span
					>{/if}
			</div>
		{/each}
	</Group>

	<Group title="Stages" count={ix.stages.length}>
		<ol class="flex flex-col gap-1 text-[12.5px]">
			{#each ix.stages as stage, i (stage.core.id)}
				{@const n = ix.work.filter((w) => w.core.stage === stage.core.id).length}
				<li class="flex items-center gap-2">
					<span
						class="flex size-5 items-center justify-center rounded-md bg-muted text-[11px] text-muted-foreground"
						>{i + 1}</span
					>{labelOf(ix, stage.core.id)}
					<span class="ml-auto text-[11px] text-muted-foreground"
						>{n} {n === 1 ? 'item' : 'items'}</span
					>
				</li>
			{/each}
		</ol>
	</Group>
</div>
