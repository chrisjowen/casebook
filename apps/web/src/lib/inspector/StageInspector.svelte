<script lang="ts">
	// A stage's details: its name, what is in it, and, with `edit`, adding to it, moving it left or
	// right and deleting it. Its steps move to the stage beside it when it is deleted.
	import type { StageId } from '@casebook/model';
	import ArrowLeftToLine from '@lucide/svelte/icons/arrow-left-to-line';
	import ArrowRightToLine from '@lucide/svelte/icons/arrow-right-to-line';
	import Signpost from '@lucide/svelte/icons/signpost';
	import SquareStack from '@lucide/svelte/icons/square-stack';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { labelOf, type ProcessIndex } from '$lib/graph/derive';
	import { addWork, removeStage, renameNode, shiftStage, type Edit } from '$lib/editor/ops';
	import EditText from './EditText.svelte';
	import Group from './Group.svelte';

	let {
		ix,
		stage,
		onselect,
		edit
	}: {
		ix: ProcessIndex;
		stage: StageId;
		onselect: (id: string | undefined) => void;
		/** Saves an edit of the draft, or shows why not; absent when it cannot be edited. */
		edit?: (e: Edit | string) => Promise<boolean>;
	} = $props();

	const at = $derived(ix.stages.findIndex((s) => s.core.id === stage));
	const items = $derived(ix.work.filter((w) => w.core.stage === stage));
	let name = $state('');
	let kind = $state<'step' | 'decision'>('step');
	const save = (e: Edit | string) => (edit ? edit(e) : Promise.resolve(false));
	const button =
		'inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40';
</script>

<div class="flex flex-col">
	<div class="flex flex-col gap-3.5 px-5 pt-4 pb-5">
		<EditText
			label="Stage"
			value={labelOf(ix, stage)}
			onsave={edit && ((title) => save(renameNode(ix, stage, title)))}
		/>
		<p class="text-[12px] text-muted-foreground">
			Stage {at + 1} of {ix.stages.length}. Steps in a stage start once what they need is recorded.
		</p>
	</div>
	<Group title="In this stage" count={items.length}>
		<ul class="flex flex-col gap-0.5">
			{#each items as w (w.core.id)}
				<li>
					<button
						class="flex w-full cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1.5 text-left text-[12.5px] hover:bg-muted"
						onclick={() => onselect(w.core.id)}
					>
						{#if w.core.kind === 'decision'}<Signpost
								class="size-3.5 text-muted-foreground"
							/>{:else}<SquareStack class="size-3.5 text-muted-foreground" />{/if}
						{labelOf(ix, w.core.id)}
					</button>
				</li>
			{:else}
				<li class="text-[12px] text-muted-foreground">Nothing yet.</li>
			{/each}
		</ul>
		{#if edit}
			<div
				class="flex items-center gap-1.5 rounded-lg border border-dashed px-2 py-1 focus-within:border-solid focus-within:border-brand-ring"
			>
				<input
					type="text"
					class="h-8 min-w-0 flex-1 bg-transparent px-1 text-[13px] outline-none placeholder:text-muted-foreground"
					placeholder="Add a step, then Enter"
					aria-label="Add to this stage"
					bind:value={name}
					onkeydown={async (e) => {
						e.stopPropagation();
						if (e.key !== 'Enter' || !name.trim()) return;
						if (await save(addWork(ix.document, { kind, title: name, stage }))) name = '';
					}}
				/>
				<select
					class="h-7 cursor-pointer rounded-md bg-transparent px-1 text-[11.5px] text-muted-foreground outline-none hover:bg-muted"
					aria-label="Step or decision"
					bind:value={kind}
				>
					<option value="step">Step</option>
					<option value="decision">Decision</option>
				</select>
			</div>
		{/if}
	</Group>
	{#if edit}
		<div class="flex flex-wrap gap-2 border-t px-5 py-4">
			<button class={button} disabled={at <= 0} onclick={() => save(shiftStage(ix, stage, -1))}
				><ArrowLeftToLine class="size-3.5" />Move left</button
			>
			<button
				class={button}
				disabled={at >= ix.stages.length - 1}
				onclick={() => save(shiftStage(ix, stage, 1))}
				><ArrowRightToLine class="size-3.5" />Move right</button
			>
			<button
				class="{button} text-destructive hover:bg-destructive/10"
				onclick={async () => {
					if (await save(removeStage(ix, stage))) onselect(undefined);
				}}><Trash2 class="size-3.5" />Delete stage</button
			>
		</div>
	{/if}
</div>
