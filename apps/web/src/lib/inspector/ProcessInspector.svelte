<script lang="ts">
	// Process summary: draft and publishing, the model's publish checks in plain language, roles and
	// stages. With `edit`, names, purpose, stages and roles change the draft.
	import type { Operation, StageId } from '@casebook/model';
	import { labelOf, plainText, type ProcessIndex } from '$lib/graph/derive';
	import type { LoadedDefinition } from '$lib/definitions/types';
	import { toneBar } from '$lib/graph/tones';
	import { addRole, addStage, addStep, rename, type Edit } from '$lib/editor/ops';
	import { getEditor } from '$lib/editor/editing.svelte';
	import { draftStatus, publishBlocked } from '$lib/editor/status';
	import Field from './Field.svelte';
	import EditText from './EditText.svelte';
	import Group from './Group.svelte';
	import {
		CircleCheck,
		CircleAlert,
		TriangleAlert,
		Plus,
		Undo2,
		Upload,
		GitCommitHorizontal
	} from '@lucide/svelte';

	let {
		ix,
		loaded,
		edit,
		onselect
	}: {
		ix: ProcessIndex;
		loaded: LoadedDefinition;
		/** Saves operations as an edit of the draft; absent when it cannot be edited. */
		edit?: (ops: Operation[]) => Promise<boolean>;
		/** Selects a node, such as a step just added. */
		onselect?: (id: string) => void;
	} = $props();
	const editor = getEditor();
	const errors = $derived(loaded.issues.filter((i) => i.severity === 'error'));
	const warnings = $derived(loaded.issues.filter((i) => i.severity === 'warning'));
	const counts = $derived([
		[ix.work.length, 'Steps and decisions'],
		[ix.stages.length, 'Stages'],
		[ix.facts.length, 'Fact types']
	] as const);
	const blocked = $derived(publishBlocked(loaded));
	const run = async ({ ops, select }: Edit) => {
		if (edit && (await edit(ops)) && select) onselect?.(select);
	};
	const small =
		'flex cursor-pointer items-center gap-1.5 self-start text-[12px] text-muted-foreground hover:text-foreground';
	const MAX_CHANGES = 8;
</script>

<div class="flex flex-col">
	<div class="flex flex-col gap-3.5 px-5 pt-4 pb-5">
		<EditText
			label="Process"
			value={labelOf(ix, ix.process?.core.id)}
			onsave={edit && ix.process && ((title) => edit([rename(ix.process!.core.id, title)]))}
		/>
		<EditText
			label="Purpose"
			value={ix.process?.content}
			multiline
			placeholder="What this process is for"
			onsave={edit &&
				ix.process &&
				((content) =>
					edit([
						{ op: 'set_content', id: ix.process!.core.id, content: content === '' ? null : content }
					]))}
		/>
		<div class="grid grid-cols-2 gap-3">
			<Field label="Version"
				>{ix.document.version}{ix.document === loaded.document &&
				(!loaded.published || loaded.changes.length > 0)
					? ' (draft)'
					: ''}</Field
			>
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

	<Group title="Draft and publishing">
		<p class="text-[12px] text-muted-foreground">
			{#if loaded.policy === 'living'}Living: every edit is published as a new version straight
				away.{:else}Governed: edits stay in the draft until someone publishes them.{/if}
		</p>
		<p class="flex items-center gap-2 text-[12.5px] font-medium">
			<GitCommitHorizontal class="size-3.5 shrink-0 text-muted-foreground" />{draftStatus(loaded)}
		</p>
		{#if loaded.published}
			<p class="text-[11px] text-muted-foreground">
				Version {loaded.published.version} published by {loaded.published.by} on {new Date(
					loaded.published.at
				).toLocaleDateString(undefined, { dateStyle: 'medium' })}.
			</p>
		{/if}
		{#if loaded.changes.length}
			<ul class="flex flex-col gap-1 rounded-lg border px-3 py-2 text-[12px]">
				{#each loaded.changes.slice(0, MAX_CHANGES) as change, i (i)}
					<li class="flex items-start gap-2">
						<span class="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand"></span>{plainText(
							ix,
							change
						)}
					</li>
				{/each}
				{#if loaded.changes.length > MAX_CHANGES}
					<li class="pl-3.5 text-muted-foreground">
						and {loaded.changes.length - MAX_CHANGES} more
					</li>
				{/if}
			</ul>
		{/if}
		<div class="flex flex-wrap items-center gap-2">
			{#if loaded.policy === 'governed'}
				<button
					class="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[12.5px] font-medium text-white enabled:cursor-pointer enabled:hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
					disabled={!!blocked || editor?.busy}
					title={blocked}
					onclick={() => editor?.publish()}
					><Upload class="size-3.5" />Publish version {(loaded.published?.version ?? 0) + 1}</button
				>
			{/if}
			<button
				class="inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[12.5px] enabled:cursor-pointer enabled:hover:bg-muted disabled:cursor-not-allowed disabled:opacity-45"
				disabled={!edit || !loaded.undoable || editor?.busy}
				title={!edit ? editor?.blocked : !loaded.undoable ? 'Nothing to undo' : undefined}
				onclick={() => editor?.undo()}><Undo2 class="size-3.5" />Undo</button
			>
		</div>
		{#if blocked && loaded.policy === 'governed' && !loaded.can.publish.allowed}
			<p class="text-[11px] text-muted-foreground">{blocked}</p>
		{/if}
	</Group>

	<Group title="Publish checks">
		{#if loaded.errors.length}
			<p class="flex items-start gap-2 text-[12.5px] font-medium">
				<CircleAlert class="mt-0.5 size-3.5 shrink-0 text-destructive" />The definition does not
				match the schema, so the other checks did not run.
			</p>
			<ul class="flex flex-col gap-1.5 pl-5.5 text-[12px] text-muted-foreground">
				{#each loaded.errors as e, i (i)}<li>{plainText(ix, e.message)}</li>{/each}
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
				{#each [...errors, ...warnings] as issue, i (i)}
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
				<span class={['size-2 shrink-0 rounded-full', toneBar[i % 6]]}></span>
				{#if edit}
					<input
						type="text"
						class="h-7 min-w-0 flex-1 rounded-md bg-transparent px-1.5 outline-none hover:bg-muted/70 focus:bg-muted/70 focus:ring-2 focus:ring-brand-ring"
						aria-label="Role name"
						value={labelOf(ix, role.core.id)}
						onchange={(e) =>
							e.currentTarget.value.trim() &&
							edit([rename(role.core.id, e.currentTarget.value.trim())])}
						onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
					/>
				{:else}{labelOf(ix, role.core.id)}{/if}
				{#if role.core.scope === 'case'}<span class="text-[11px] text-muted-foreground"
						>assigned per case</span
					>{/if}
			</div>
		{/each}
		{#if edit}
			<button class={small} onclick={() => run(addRole(ix.document))}
				><Plus class="size-3.5" />Add role</button
			>
		{/if}
	</Group>

	<Group title="Stages" count={ix.stages.length}>
		<ol class="flex flex-col gap-1 text-[12.5px]">
			{#each ix.stages as stage, i (stage.core.id)}
				{@const n = ix.work.filter((w) => w.core.stage === stage.core.id).length}
				<li class="flex items-center gap-2">
					<span
						class="flex size-5 shrink-0 items-center justify-center rounded-md bg-muted text-[11px] text-muted-foreground"
						>{i + 1}</span
					>
					{#if edit}
						<input
							type="text"
							class="h-7 min-w-0 flex-1 rounded-md bg-transparent px-1.5 outline-none hover:bg-muted/70 focus:bg-muted/70 focus:ring-2 focus:ring-brand-ring"
							aria-label="Stage name"
							value={labelOf(ix, stage.core.id)}
							onchange={(e) =>
								e.currentTarget.value.trim() &&
								edit([rename(stage.core.id, e.currentTarget.value.trim())])}
							onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
						/>
						<button
							class="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
							title="Add a step to this stage"
							aria-label="Add a step to {labelOf(ix, stage.core.id)}"
							onclick={() => run(addStep(ix.document, stage.core.id as StageId))}
							><Plus class="size-3.5" /></button
						>
					{:else}{labelOf(ix, stage.core.id)}{/if}
					<span class="ml-auto shrink-0 text-[11px] text-muted-foreground"
						>{n} {n === 1 ? 'item' : 'items'}</span
					>
				</li>
			{/each}
		</ol>
		{#if edit}
			<button class={small} onclick={() => run(addStage(ix.document))}
				><Plus class="size-3.5" />Add stage</button
			>
		{/if}
	</Group>
</div>
