<script lang="ts">
	// Process summary: draft and publishing, the model's publish checks in plain language, roles,
	// stages and facts. With `edit`, its name, purpose and roles change the draft; stages are built
	// on the board, and every stage and fact here opens its details.
	import { tick } from 'svelte';
	import type { FactNode, Operation } from '@casebook/model';
	import {
		collectorsByFact,
		factType,
		labelOf,
		plainText,
		type ProcessIndex
	} from '$lib/graph/derive';
	import { glyphIcon } from '$lib/graph/glyphs';
	import type { LoadedDefinition } from '$lib/definitions/types';
	import { toneBar } from '$lib/graph/tones';
	import { addRole, rename } from '$lib/editor/ops';
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
	const collectors = $derived(collectorsByFact(ix));
	const renameFrom = async (field: HTMLInputElement, id: string) => {
		const title = field.value.trim();
		if (!title || !(await edit?.([rename(id, title)]))) field.value = labelOf(ix, id);
	};
	/** Adds a role and puts the cursor in its name, ready to type over "New role". */
	let roleList = $state<HTMLElement>();
	async function addNewRole() {
		if (!edit || !(await edit(addRole(ix.document).ops))) return;
		await tick();
		const fields = roleList?.parentElement?.querySelectorAll<HTMLInputElement>(
			'input[aria-label="Role name"]'
		);
		const last = fields?.[fields.length - 1];
		last?.focus();
		last?.select();
	}
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
			<Field label="Workspace">{ix.document.namespace.replaceAll('/', ' / ')}</Field>
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
		<span bind:this={roleList} hidden></span>
		{#each ix.roles as role, i (role.core.id)}
			<div class="flex items-center gap-2 text-[12.5px]">
				<span class={['size-2 shrink-0 rounded-full', toneBar[i % 6]]}></span>
				{#if edit}
					<input
						type="text"
						class="h-7 min-w-0 flex-1 rounded-md bg-transparent px-1.5 outline-none hover:bg-muted/70 focus:bg-muted/70 focus:ring-2 focus:ring-brand-ring"
						aria-label="Role name"
						value={labelOf(ix, role.core.id)}
						onchange={(e) => renameFrom(e.currentTarget, role.core.id)}
						onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
					/>
				{:else}{labelOf(ix, role.core.id)}{/if}
				{#if role.core.scope === 'case'}<span class="text-[11px] text-muted-foreground"
						>assigned per case</span
					>{/if}
			</div>
		{/each}
		{#if edit}
			<button class={small} onclick={addNewRole}><Plus class="size-3.5" />Add role</button>
		{/if}
	</Group>

	<Group title="Stages" count={ix.stages.length}>
		<ol class="flex flex-col gap-0.5 text-[12.5px]">
			{#each ix.stages as stage, i (stage.core.id)}
				{@const n = ix.work.filter((w) => w.core.stage === stage.core.id).length}
				<li>
					<button
						class="flex w-full cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-muted"
						onclick={() => onselect?.(stage.core.id)}
					>
						<span
							class="flex size-5 shrink-0 items-center justify-center rounded-md bg-muted text-[11px] text-muted-foreground"
							>{i + 1}</span
						>
						<span class="min-w-0 flex-1 truncate">{labelOf(ix, stage.core.id)}</span>
						<span class="shrink-0 text-[11px] text-muted-foreground"
							>{n} {n === 1 ? 'item' : 'items'}</span
						>
					</button>
				</li>
			{/each}
		</ol>
	</Group>

	<Group title="Facts" count={ix.facts.length}>
		<ul class="flex flex-col gap-0.5 text-[12.5px]">
			{#each ix.facts as fact (fact.core.id)}
				{@const kind = factType((fact as FactNode).core.schema)}
				{@const Glyph = glyphIcon[kind.glyph]}
				{@const by = collectors.get(fact.core.id) ?? []}
				<li>
					<button
						class="flex w-full cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-muted"
						onclick={() => onselect?.(fact.core.id)}
					>
						<Glyph class="size-3.5 shrink-0 text-muted-foreground" />
						<span class="min-w-0 flex-1 truncate">{labelOf(ix, fact.core.id)}</span>
						<span
							class={[
								'max-w-[45%] shrink-0 truncate text-[11px]',
								by.length ? 'text-muted-foreground' : 'text-amber-700'
							]}>{by.length ? labelOf(ix, by[0]) : 'Not recorded yet'}</span
						>
					</button>
				</li>
			{/each}
		</ul>
	</Group>
</div>
