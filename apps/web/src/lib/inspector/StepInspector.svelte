<script lang="ts">
	// Definition inspector for a step or decision: who does it, what it records, what it needs
	// first and the rules it runs under. With `edit`, facts are added, renamed and removed right in
	// "Records" and "Needs first", and every field changes the draft; it is never a form for case
	// data.
	import type {
		ApprovalNode,
		Guard,
		DecisionNode,
		FactNode,
		RoleId,
		StageId,
		StepNode
	} from '@casebook/model';
	import {
		ChevronRight,
		Copy,
		FlaskConical,
		Eye,
		FileText,
		GitBranch,
		Plus,
		Repeat,
		ShieldCheck,
		Sparkles,
		Split,
		Trash2,
		UserPlus,
		X
	} from '@lucide/svelte';
	import {
		describeEvidence,
		humanizeDuration,
		labelOf,
		type ProcessIndex,
		type WorkItem
	} from '$lib/graph/derive';
	import BranchTest from '$lib/conditions/BranchTest.svelte';
	import { branchChoices, factTiming } from '$lib/conditions/conditions';
	import ConditionEditor from '$lib/conditions/ConditionEditor.svelte';
	import { roleTone } from '$lib/graph/layout';
	import { toneBar } from '$lib/graph/tones';
	import {
		addApproval,
		addRole,
		addWork,
		branchGuard,
		duplicate,
		moveToStage,
		removeApproval,
		removeWork,
		renameNode,
		setChoices,
		setWhen,
		type Edit
	} from '$lib/editor/ops';
	import EditSelect from './EditSelect.svelte';
	import EditText from './EditText.svelte';
	import FactList from './FactList.svelte';
	import Field from './Field.svelte';
	import FieldPreview from './FieldPreview.svelte';
	import Group from './Group.svelte';

	let {
		ix,
		item,
		onselect,
		edit,
		publishes = false
	}: {
		ix: ProcessIndex;
		item: WorkItem;
		/** Opens another node's details, such as a fact. */
		onselect: (id: string | undefined) => void;
		/** Saves an edit of the draft, or shows why not; absent when it cannot be edited. */
		edit?: (e: Edit | string) => Promise<boolean>;
		/** True when every saved edit publishes at once, as in a living process. */
		publishes?: boolean;
	} = $props();

	const core = $derived(item.core);
	const id = $derived(core.id);
	const step = $derived(core.kind === 'step' ? (item as StepNode) : undefined);
	const decision = $derived(core.kind === 'decision' ? (item as DecisionNode) : undefined);
	const approval = $derived(
		step?.core.approval ? (ix.byId.get(step.core.approval) as ApprovalNode | undefined) : undefined
	);
	const outcome = $derived(
		decision ? (ix.byId.get(decision.core.outcome) as FactNode | undefined) : undefined
	);
	const choices = $derived(
		Array.isArray(outcome?.core.schema.enum) ? outcome.core.schema.enum.map(String) : []
	);
	const actors = [
		{ value: 'human', label: 'Person' },
		{ value: 'agent', label: 'Agent' },
		{ value: 'either', label: 'Either' }
	] as const;
	const set = (changes: Record<string, unknown>, label: string): Edit => ({
		ops: [{ op: 'update_core', id, changes }],
		label
	});
	const save = (e: Edit | string) => (edit ? edit(e) : Promise.resolve(false));
	let preview = $state(false);
	let newChoice = $state('');
	let branchFor = $state<string | undefined>();
	/** A rule being added, open to build and not saved until its Save. */
	let adding = $state<'when' | 'repeat' | undefined>();
	const timing = $derived(factTiming(ix, id));
	const whenOutcome = $derived({
		true: `${decision ? 'this decision' : 'this step'} runs`,
		false: `${decision ? 'this decision' : 'this step'} is skipped`,
		unknown: 'it waits until these are recorded'
	});
	const untilOutcome = {
		true: 'it stops repeating',
		false: 'it keeps repeating',
		unknown: 'it keeps repeating until these are recorded'
	};
	const saveWhen = async (when: Guard, label: string) => {
		const ok = await save({ ops: [setWhen(id, when)], label });
		if (ok) adding = undefined;
		return ok;
	};
	const saveUntil = async (until: Guard, label: string) => {
		const repeat = step!.core.repeat ?? { until, every: 'PT1H' };
		const ok = await save(set({ repeat: { ...repeat, until } }, label));
		if (ok) adding = undefined;
		return ok;
	};
	let testBranches = $state(false);
	const INTERVALS = ['PT15M', 'PT30M', 'PT1H', 'PT4H', 'P1D', 'P7D'];
	let branchName = $state('');

	async function setRole(value: string) {
		if (value !== '__new')
			return save(
				set({ role: value as RoleId }, `${labelOf(ix, id)} is now done by ${labelOf(ix, value)}`)
			);
		const role = addRole(ix.document);
		return save({
			ops: [...role.ops, { op: 'update_core', id, changes: { role: role.id } }],
			label: `Added a role for ${labelOf(ix, id)}; rename it under the process details`
		});
	}
	async function addBranch(choice: string) {
		if (!decision || !branchName.trim()) return;
		const added = addWork(ix.document, {
			kind: 'step',
			title: branchName,
			stage: decision.core.stage,
			role: decision.core.role,
			requires: [decision.core.outcome],
			when: branchGuard(ix, decision.core.outcome, choice)
		});
		if (await save(added)) {
			branchFor = undefined;
			branchName = '';
		}
	}
	const branchSteps = (choice: string) =>
		decision
			? ix.work.filter((w) => w.core.id !== id && branchChoices(ix, decision, w).includes(choice))
			: [];
	const focus = (el: HTMLInputElement) => el.focus();
	const quiet =
		'inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-dashed px-2.5 py-1.5 text-[12px] text-muted-foreground hover:border-brand-ring hover:text-foreground';
	const remove =
		'flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-destructive';
</script>

<div class="flex flex-col">
	<div class="flex flex-col gap-3.5 px-5 pt-4 pb-5">
		<EditText
			label={decision ? 'Decision' : 'Step'}
			value={labelOf(ix, id)}
			onsave={edit && ((title) => save(renameNode(ix, id, title)))}
		/>
		<div class="grid grid-cols-2 gap-3">
			<EditSelect
				label="Stage"
				value={core.stage}
				options={ix.stages.map((s) => ({ value: s.core.id, label: labelOf(ix, s.core.id) }))}
				onsave={edit && ((stage) => save(moveToStage(ix, id, stage as StageId)))}
			/>
			<EditSelect
				label="Done by"
				value={core.role}
				options={[
					...ix.roles.map((r) => ({ value: r.core.id, label: labelOf(ix, r.core.id) })),
					...(edit ? [{ value: '__new', label: 'New role…' }] : [])
				]}
				onsave={edit && setRole}
			>
				<span class="flex items-center gap-1.5"
					><span class={['size-2 shrink-0 rounded-full', toneBar[roleTone(ix, core.role)]]}
					></span>{labelOf(ix, core.role)}</span
				>
			</EditSelect>
		</div>
		<div class="flex flex-col gap-1.5">
			<div class="text-[12px] text-muted-foreground">Who can complete it</div>
			<div
				class="grid grid-cols-3 gap-1 rounded-lg bg-muted/70 p-1"
				role="radiogroup"
				aria-label="Who can complete it"
			>
				{#each actors as a (a.value)}
					<button
						role="radio"
						aria-checked={core.actor === a.value}
						disabled={!edit}
						class={[
							'rounded-md py-1.5 text-center text-[12.5px]',
							core.actor === a.value
								? 'bg-background font-medium shadow-xs'
								: 'text-muted-foreground',
							edit && 'cursor-pointer hover:text-foreground'
						]}
						onclick={() =>
							core.actor !== a.value &&
							save(set({ actor: a.value }, `${labelOf(ix, id)}: ${a.label}`))}>{a.label}</button
					>
				{/each}
			</div>
		</div>
	</div>

	{#if decision && outcome}
		<Group title="Outcome" count={choices.length}>
			<EditText
				label="It records"
				value={labelOf(ix, outcome.core.id)}
				onsave={edit && ((title) => save(renameNode(ix, outcome.core.id, title)))}
			/>
			<ul class="flex flex-col gap-1.5">
				{#each choices as choice (choice)}
					{@const steps = branchSteps(choice)}
					<li class="flex items-start gap-2 rounded-lg border px-2.5 py-2">
						<GitBranch class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
						<div class="min-w-0 flex-1">
							<div class="text-[13px] font-medium">{choice}</div>
							<div
								class="mt-0.5 flex flex-wrap items-center gap-1 text-[11.5px] text-muted-foreground"
							>
								{#each steps as s (s.core.id)}
									<button
										class="cursor-pointer rounded-md bg-muted px-1.5 hover:text-foreground"
										onclick={() => onselect(s.core.id)}>→ {labelOf(ix, s.core.id)}</button
									>
								{:else}
									<span>Nothing runs only for this yet.</span>
								{/each}
								{#if edit && branchFor === choice}
									<input
										type="text"
										class="h-6 w-40 rounded-md border bg-background px-1.5 text-[12px] text-foreground outline-none focus:ring-2 focus:ring-brand-ring"
										placeholder="Step name, then Enter"
										aria-label="Name of the step for {choice}"
										bind:value={branchName}
										use:focus
										onkeydown={(e) => {
											e.stopPropagation();
											if (e.key === 'Enter') addBranch(choice);
											if (e.key === 'Escape') branchFor = undefined;
										}}
									/>
								{:else if edit}
									<button
										class="inline-flex cursor-pointer items-center gap-0.5 rounded-md px-1 text-brand hover:bg-brand-soft"
										onclick={() => (branchFor = choice)}><Plus class="size-3" />Step</button
									>
								{/if}
							</div>
						</div>
						{#if edit}
							<button
								class={remove}
								disabled={choices.length <= 1}
								aria-label="Remove choice {choice}"
								onclick={() =>
									save(
										setChoices(
											ix,
											outcome.core.id,
											choices.filter((c) => c !== choice)
										)
									)}><X class="size-3.5" /></button
							>
						{/if}
					</li>
				{/each}
			</ul>
			{#if edit}
				<input
					type="text"
					class="h-8 rounded-lg border border-dashed bg-background px-2.5 text-[12.5px] outline-none placeholder:text-muted-foreground focus:border-solid focus:ring-2 focus:ring-brand-ring"
					placeholder="Add a choice, then Enter"
					aria-label="Add a choice"
					bind:value={newChoice}
					onkeydown={async (e) => {
						e.stopPropagation();
						const c = newChoice.trim();
						if (e.key !== 'Enter' || !c) return;
						if (choices.includes(c)) return save(`${c} is already a choice`);
						if (await save(setChoices(ix, outcome.core.id, [...choices, c]))) newChoice = '';
					}}
				/>
			{/if}
			<button
				class="flex cursor-pointer items-center gap-1.5 self-start text-[12px] text-muted-foreground hover:text-foreground"
				aria-expanded={testBranches}
				onclick={() => (testBranches = !testBranches)}
				><FlaskConical class="size-3.5" />Test the branches<ChevronRight
					class={['size-3.5 transition-transform', testBranches && 'rotate-90']}
				/></button
			>
			{#if testBranches && decision}<BranchTest {ix} {decision} {onselect} />{/if}
		</Group>
	{:else}
		<Group title="Records" count={step?.core.collects?.length ?? 0}>
			{#if edit}<p class="-mt-1 text-[11.5px] text-muted-foreground">
					What this step asks someone for. Type a name and press Enter to add one.
				</p>{/if}
			<FactList {ix} {item} list="records" edit={edit && save} {onselect} />
			{#if step?.core.assigns?.length}
				{#each step.core.assigns as assign (assign.role)}
					<div
						class="flex items-start gap-2 rounded-lg border border-dashed px-3 py-2 text-[12px] text-muted-foreground"
					>
						<UserPlus class="mt-0.5 size-3.5 shrink-0" />
						<span
							>Assigns the people in “{labelOf(ix, assign.fact)}” to the {labelOf(ix, assign.role)} role
							for the case.</span
						>
					</div>
				{/each}
			{/if}
			{#if step?.core.collects?.length}
				<button
					class="flex cursor-pointer items-center gap-1.5 self-start text-[12px] text-muted-foreground hover:text-foreground"
					aria-expanded={preview}
					onclick={() => (preview = !preview)}
				>
					<Eye class="size-3.5" />{preview ? 'Hide' : 'Show'} form preview<ChevronRight
						class={['size-3.5 transition-transform', preview && 'rotate-90']}
					/>
				</button>
				{#if preview}
					<div class="rounded-xl border border-dashed bg-muted/30 p-3">
						<p class="mb-2.5 text-[11px] font-medium text-muted-foreground">
							Preview of what this step will ask. Read-only; nothing is filled in here.
						</p>
						<div class="pointer-events-none flex flex-col gap-3 opacity-80 select-none" inert>
							{#each step.core.collects as collect (collect.fact)}
								{@const fact = ix.byId.get(collect.fact) as FactNode | undefined}
								{#if fact}<FieldPreview {ix} {fact} />{/if}
							{/each}
						</div>
					</div>
				{/if}
			{/if}
		</Group>
	{/if}

	{#if step?.core.evidence?.some((e) => !e.fact)}
		<Group title="Evidence">
			{#each step.core.evidence.filter((e) => !e.fact) as e, i (i)}
				<div class="flex items-start gap-2 text-[12.5px]">
					<FileText class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />{e.description} · {describeEvidence(
						e
					)}
				</div>
			{/each}
		</Group>
	{/if}

	<Group title="Needs first" count={core.requires?.length ?? 0}>
		{#if edit}<p class="-mt-1 text-[11.5px] text-muted-foreground">
				{core.requires?.length
					? 'What must be recorded before this can start.'
					: 'Nothing, so it can start straight away. Add what must be recorded first.'}
			</p>{/if}
		<FactList {ix} {item} list="needs" edit={edit && save} {onselect} />
	</Group>

	<Group title="Rules">
		{#if core.when || adding === 'when'}
			<ConditionEditor
				{ix}
				guard={core.when ?? { text: '' }}
				label="Only when"
				icon={Split}
				lead="Only when"
				open={adding === 'when'}
				outcome={whenOutcome}
				{publishes}
				{timing}
				onsave={edit && saveWhen}
				onremove={edit &&
					core.when &&
					(() => save({ ops: [setWhen(id, null)], label: 'Removed the condition' }))}
				oncancel={() => (adding = undefined)}
				removeLabel="Remove the condition"
			/>
		{/if}
		{#if step && (step.core.repeat || adding === 'repeat')}
			<ConditionEditor
				{ix}
				guard={step.core.repeat?.until ?? { text: '' }}
				label="Stops repeating when"
				icon={Repeat}
				lead="Until"
				open={adding === 'repeat'}
				outcome={untilOutcome}
				{publishes}
				onsave={edit && saveUntil}
				onremove={edit &&
					step.core.repeat &&
					(() => save(set({ repeat: null }, `${labelOf(ix, id)} no longer repeats`)))}
				oncancel={() => (adding = undefined)}
				removeLabel="Stop repeating"
			/>
		{/if}
		{#if step?.core.repeat}
			<label class="ml-5.5 flex items-center gap-2 text-[12px] text-muted-foreground">
				Suggested every
				<select
					class="h-7 cursor-pointer rounded-md bg-muted/70 px-1.5 text-[12px] text-foreground outline-none focus:ring-2 focus:ring-brand-ring disabled:cursor-default"
					value={step.core.repeat.every ?? ''}
					disabled={!edit}
					onchange={(e) => {
						const every = e.currentTarget.value || undefined;
						const rest = { ...step!.core.repeat! };
						delete rest.every;
						save(
							set(
								{ repeat: every ? { ...rest, every } : rest },
								every
									? `${labelOf(ix, id)} repeats every ${humanizeDuration(every)}`
									: `${labelOf(ix, id)} has no set interval`
							)
						);
					}}
				>
					<option value="">No set interval</option>
					{#each INTERVALS as every (every)}<option value={every}>{humanizeDuration(every)}</option
						>{/each}
					{#if step.core.repeat.every && !INTERVALS.includes(step.core.repeat.every)}
						<option value={step.core.repeat.every}
							>{humanizeDuration(step.core.repeat.every)}</option
						>
					{/if}
				</select>
			</label>
		{/if}
		{#if approval}
			<div class="flex items-start gap-2.5 rounded-lg border px-3 py-2">
				<ShieldCheck class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
				<div class="min-w-0 flex-1 text-[12.5px]">
					<div class="font-medium">{labelOf(ix, approval.core.id)}</div>
					<div class="text-[11px] text-muted-foreground">
						By {labelOf(ix, approval.core.role)} · {approval.core.actor === 'human'
							? 'a person must approve; agents cannot'
							: approval.core.actor === 'agent'
								? 'an agent approves'
								: 'a person or an agent'}
					</div>
					{#if approval.content}<p class="mt-1 text-[12px] text-muted-foreground">
							{approval.content}
						</p>{/if}
				</div>
				{#if edit}
					<button
						class={remove}
						aria-label="Remove the approval"
						onclick={() => {
							const change = removeApproval(ix, id);
							if (change) save(change);
						}}><X class="size-3.5" /></button
					>
				{/if}
			</div>
		{/if}
		{#if !core.when && !step?.core.repeat && !approval && !adding}
			<p class="text-[12px] text-muted-foreground">Always runs once what it needs is recorded.</p>
		{/if}
		{#if edit}
			<div class="flex flex-wrap gap-1.5">
				{#if !core.when && adding !== 'when'}
					<button class={quiet} onclick={() => (adding = 'when')}
						><Split class="size-3.5" />Only when…</button
					>
				{/if}
				{#if step && !step.core.repeat && adding !== 'repeat'}
					<button class={quiet} onclick={() => (adding = 'repeat')}
						><Repeat class="size-3.5" />Repeats…</button
					>
				{/if}
				{#if step && !approval}
					<button class={quiet} onclick={() => save(addApproval(ix.document, id))}
						><ShieldCheck class="size-3.5" />Needs approval</button
					>
				{/if}
			</div>
		{/if}
	</Group>

	<Group title="Guidance">
		<EditText
			label="What people doing this should know"
			value={item.content}
			multiline
			placeholder="What people doing this should know"
			onsave={edit &&
				((content) =>
					save({
						ops: [{ op: 'set_content', id, content: content || null }],
						label: 'Saved the guidance'
					}))}
		/>
		{#if !edit && !item.content}<p class="text-[12px] text-muted-foreground">None.</p>{/if}
	</Group>

	<Group title="Source">
		{#if core.source}
			<Field label={core.source.inferred ? 'Inferred from' : 'Taken from'}>
				<span class="flex items-start gap-2">
					{#if core.source.inferred}<Sparkles
							class="mt-0.5 size-3.5 shrink-0 text-brand"
						/>{:else}<FileText class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />{/if}
					{core.source.doc}{core.source.ref ? ` · ${core.source.ref}` : ''}
				</span>
			</Field>
			{#if core.source.inferred}<p class="text-[11px] text-muted-foreground">
					Not stated in the source; inferred when the definition was drafted.
				</p>{/if}
		{:else}
			<p class="text-[12px] text-muted-foreground">Added by hand.</p>
		{/if}
	</Group>

	{#if edit}
		<div class="flex gap-2 border-t px-5 py-4">
			<button
				class="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] hover:bg-muted"
				onclick={() => save(duplicate(ix.document, id))}><Copy class="size-3.5" />Duplicate</button
			>
			<button
				class="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] text-destructive hover:bg-destructive/10"
				onclick={async () => {
					if (await save(removeWork(ix, id))) onselect(undefined);
				}}><Trash2 class="size-3.5" />Delete</button
			>
		</div>
	{/if}
</div>
