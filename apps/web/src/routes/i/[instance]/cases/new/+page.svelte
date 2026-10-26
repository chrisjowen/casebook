<script lang="ts">
	// Start a case as a short guided flow, one question at a time: what to run, which case it is
	// for and who's who, then a check of what happens next before starting. Every step is part of
	// one form, so Back never loses an answer, and the URL can preselect the process (?process=)
	// or the case (?case=, to add a process to it).
	import Check from '@lucide/svelte/icons/check';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import CircleDot from '@lucide/svelte/icons/circle-dot';
	import { runnableProcess } from '@casebook/model';
	import Frame from '$lib/runner/Frame.svelte';
	import StageStrip from '$lib/runner/StageStrip.svelte';
	import { lowerFirst } from '$lib/runner/format';
	import { links } from '$lib/runner/links';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const slug = $derived(data.instance.slug);
	const fixed = $derived(data.cases.find((c) => c.id === data.fixedCase));
	const failure = $derived((form ?? {}) as { reason?: string; problems?: Record<string, string> });

	// The first choices come from the URL (?process=, ?case=); then the form owns them.
	const initial = () => {
		const process =
			data.processes.find((p) => p.slug === data.preselect || p.id === data.preselect)?.id ??
			(data.processes.length === 1 ? data.processes[0]!.id : '');
		return {
			process,
			target: (data.fixedCase ? 'existing' : 'new') as 'new' | 'existing',
			existing: data.fixedCase ?? data.cases[0]?.id ?? '',
			// A process chosen already skips straight to the case.
			step: process ? 1 : 0
		};
	};
	const start = initial();
	let chosen = $state(start.process);
	let target = $state(start.target);
	let existing = $state(start.existing);
	let step = $state(start.step);
	let title = $state('');
	let subject = $state('');
	let label = $state('');
	let nameProblem = $state('');
	/** Roles nobody holds that were left empty, which would leave their work waiting on nobody. */
	let roleProblem = $state('');
	/** Who fills each case role, by role id. */
	let people = $state<Record<string, string[]>>({});

	const selected = $derived(data.processes.find((p) => p.id === chosen));
	const process = $derived(selected ? runnableProcess(selected.document) : undefined);
	const first = $derived(process?.items[0]);
	// Roles named on this case: the case-scoped ones, and any role its work needs that nobody
	// holds yet. Those a step fills from what it records are left to it.
	const caseRoles = $derived(
		process
			? [...process.roles.values()]
					.filter(
						(r) =>
							(r.scope === 'case' ||
								(selected!.unheld.includes(r.id) && process.items.some((i) => i.role === r.id))) &&
							!process.items.some((i) => i.assigns.some((a) => a.role === r.id))
					)
					.sort((a, b) => firstUse(a.id) - firstUse(b.id))
			: []
	);
	/** Where a role's work first comes in the process, to list roles in the order they are needed. */
	const firstUse = (role: string) => {
		const at = process?.items.findIndex((i) => i.role === role) ?? -1;
		return at < 0 ? Infinity : at;
	};
	// The starter takes the first task's role unless they say otherwise.
	$effect(() => {
		const role = first?.role;
		if (role && caseRoles.some((r) => r.id === role) && people[role] === undefined) {
			people[role] = [data.user.id];
		}
	});
	const onCase = $derived(
		target === 'existing' && data.cases.find((c) => c.id === existing)?.processes.includes(chosen)
	);
	const caseTitle = $derived(
		fixed?.title ??
			(target === 'new' ? title.trim() : data.cases.find((c) => c.id === existing)?.title) ??
			''
	);
	const nameOf = (id: string) =>
		id === data.user.id ? 'you' : (data.people.find((p) => p.id === id)?.name ?? 'someone');
	const roleTitle = (id: string) => process?.roles.get(id)?.title ?? id;
	/** Who does work in a role, as far as the form knows. */
	const whoDoes = (role: string) => {
		const named = people[role];
		if (named?.length) return named.map(nameOf).join(' or ');
		return `the ${lowerFirst(roleTitle(role))}`;
	};
	// The first stage's work, which is what starting the case sets off.
	const firstStage = $derived(
		process
			? process.items.filter((i) => i.stage === process.stages[0]?.id && i.kind !== 'approval')
			: []
	);
	const goingToFirst = $derived(first !== undefined && people[first.role]?.includes(data.user.id));

	const steps = $derived([
		{ title: 'Process', summary: selected?.title },
		{ title: fixed ? 'Details' : 'Case', summary: caseTitle },
		{ title: 'Check and start', summary: undefined }
	]);

	function next() {
		if (step === 1 && !fixed && target === 'new' && !title.trim()) {
			nameProblem = 'Give the case a name';
			document.getElementById('title')?.focus();
			return;
		}
		nameProblem = '';
		const empty = caseRoles.filter((r) => r.scope !== 'case' && !people[r.id]?.length);
		if (step === 1 && empty.length) {
			roleProblem = `Choose who does ${empty.map((r) => r.title ?? r.id).join(' and ')}: nobody else has ${empty.length === 1 ? 'that role' : 'those roles'}, so ${empty.length === 1 ? 'its' : 'their'} work would wait on nobody`;
			return;
		}
		roleProblem = '';
		step = Math.min(step + 1, 2);
	}

	// A refused start (a name, a role) goes back to the step it belongs to.
	$effect(() => {
		if (failure.problems?.title) step = 1;
		else if (failure.problems && Object.keys(failure.problems).some((k) => k.startsWith('role:')))
			step = 1;
	});

	const input =
		'h-10 rounded-lg border bg-background px-3 text-[14px] outline-none focus:ring-2 focus:ring-brand-ring';
	const choice =
		'flex cursor-pointer items-start gap-3 rounded-xl border bg-card px-4 py-3.5 text-[13px] hover:border-foreground/20 has-checked:border-brand has-checked:bg-brand-soft';
	const primary =
		'h-10 cursor-pointer rounded-lg bg-foreground px-5 text-[14px] font-medium text-background hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-50';
	const back =
		'flex h-10 cursor-pointer items-center gap-1 rounded-lg px-3 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground';
</script>

<svelte:head
	><title>{fixed ? `Add a process to ${fixed.title}` : 'Start a case'}</title></svelte:head
>

<Frame
	user={data.user}
	instance={data.instance}
	instances={data.instances}
	crumbs={fixed
		? [{ label: fixed.title, href: links.case(slug, fixed.id) }, { label: 'Add a process' }]
		: [{ label: 'Start a case' }]}
>
	<div class="px-4 py-8 lg:px-6">
		<header class="mb-8 max-w-5xl">
			<h1 class="text-[22px] font-semibold tracking-tight">
				{fixed ? `Add a process to ${fixed.title}` : 'Start a case'}
			</h1>
			<p class="mt-1 text-[14px] text-muted-foreground">
				Three short steps. Nothing starts until you have checked it.
			</p>
		</header>

		{#if !data.processes.length}
			<p
				class="max-w-3xl rounded-xl border border-dashed bg-card px-5 py-8 text-[13px] text-muted-foreground"
			>
				There is no published process here that you can start. Starting one needs write access, or a
				role in the process.
			</p>
		{:else}
			<div class="grid max-w-5xl gap-8 md:grid-cols-[13rem_minmax(0,1fr)]">
				<!-- Where you are in the flow; finished steps can be revisited. -->
				<p class="-mt-4 text-[13px] text-muted-foreground md:hidden" aria-hidden="true">
					Step {step + 1} of 3 · {steps[step]?.title}
				</p>
				<nav aria-label="Steps" class="hidden md:block">
					<ol class="grid gap-1">
						{#each steps as s, i (s.title)}
							<li>
								<button
									type="button"
									disabled={i > step}
									aria-current={i === step ? 'step' : undefined}
									onclick={() => (step = i)}
									class={[
										'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] disabled:cursor-default',
										i === step
											? 'bg-card font-medium shadow-sm ring-1 ring-border'
											: 'enabled:hover:bg-muted',
										i > step && 'text-muted-foreground'
									]}
								>
									<span
										class={[
											'mt-px grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold',
											i < step
												? 'bg-brand text-white'
												: i === step
													? 'bg-foreground text-background'
													: 'bg-muted'
										]}
										>{#if i < step}<Check class="size-3" aria-label="Done" />{:else}{i +
												1}{/if}</span
									>
									<span class="min-w-0">
										{s.title}
										{#if i < step && s.summary}<span
												class="block truncate text-[12px] font-normal text-muted-foreground"
												>{s.summary}</span
											>{/if}
									</span>
								</button>
							</li>
						{/each}
					</ol>
				</nav>

				<form
					method="POST"
					class="max-w-2xl min-w-0"
					onsubmit={(e) => {
						// Enter moves on a step; only the last one starts the case.
						if (step < 2) {
							e.preventDefault();
							next();
						}
					}}
				>
					{#if failure.reason}<p
							class="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-[13px] font-medium text-destructive"
							role="alert"
						>
							{failure.reason}
						</p>{/if}
					<input type="hidden" name="processTitle" value={selected?.title ?? ''} />

					<!-- 1. What to run -->
					<fieldset class={['grid gap-3', step !== 0 && 'hidden']}>
						<legend class="mb-3 text-[17px] font-semibold">What do you want to run?</legend>
						{#each data.processes as p (p.id)}
							{@const summary = runnableProcess(p.document).summary}
							<label class={choice}>
								<input
									type="radio"
									name="process"
									value={p.id}
									bind:group={chosen}
									class="mt-0.5 accent-brand"
								/>
								<span class="min-w-0">
									<span class="text-[14px] font-medium">{p.title}</span>
									{#if fixed?.processes.includes(p.id)}<span
											class="ml-1 text-[12px] text-muted-foreground">· already on this case</span
										>{/if}
									{#if summary}<span class="mt-0.5 block text-muted-foreground">{summary}</span
										>{/if}
								</span>
							</label>
						{/each}
						<div class="mt-3 flex items-center gap-2">
							<button type="button" class={primary} disabled={!chosen} onclick={next}
								>Continue</button
							>
							<a
								href={fixed ? links.case(slug, fixed.id) : links.cases(slug)}
								class="px-3 text-[13px] text-muted-foreground hover:text-foreground">Cancel</a
							>
						</div>
					</fieldset>

					<!-- 2. Which case, and who's who -->
					<div class={['grid gap-6', step !== 1 && 'hidden']}>
						{#if fixed}
							<input type="hidden" name="target" value="existing" />
							<input type="hidden" name="existing" value={fixed.id} />
						{:else}
							<fieldset class="grid gap-3">
								<legend class="mb-3 text-[17px] font-semibold">Which case is it for?</legend>
								<label class={choice}>
									<input
										type="radio"
										name="target"
										bind:group={target}
										value="new"
										class="mt-0.5 accent-brand"
									/>
									<span
										><span class="text-[14px] font-medium">Someone or something new</span><span
											class="mt-0.5 block text-muted-foreground"
											>Such as a new incident, claim or family member.</span
										></span
									>
								</label>
								<label class={[choice, !data.cases.length && 'opacity-60']}>
									<input
										type="radio"
										name="target"
										bind:group={target}
										value="existing"
										class="mt-0.5 accent-brand"
										disabled={!data.cases.length}
									/>
									<span
										><span class="text-[14px] font-medium">A case that’s already open</span><span
											class="mt-0.5 block text-muted-foreground"
											>It shares that case’s record, so nothing already recorded is asked for again.</span
										></span
									>
								</label>

								{#if target === 'new'}
									<div class="mt-2 grid gap-1.5">
										<label for="title" class="text-[13px] font-medium">Case name</label>
										<input
											id="title"
											name="title"
											class={input}
											bind:value={title}
											aria-invalid={!!(nameProblem || failure.problems?.title)}
											placeholder="Who or what it’s for, such as a name or a reference"
										/>
										{#if nameProblem || failure.problems?.title}<p
												class="text-[12px] font-medium text-destructive"
											>
												{nameProblem || failure.problems?.title}
											</p>{/if}
									</div>
									<div class="grid gap-1.5">
										<label for="subject" class="text-[13px] font-medium"
											>What it’s about <span class="font-normal text-muted-foreground"
												>(optional)</span
											></label
										>
										<input
											id="subject"
											name="subject"
											class={input}
											bind:value={subject}
											placeholder="One line, such as who or what it concerns"
										/>
									</div>
								{:else}
									<div class="mt-2 grid gap-1.5">
										<label for="existing" class="text-[13px] font-medium">Case</label>
										<select id="existing" name="existing" class={input} bind:value={existing}>
											{#each data.cases as c (c.id)}<option value={c.id}>{c.title}</option>{/each}
										</select>
										{#if onCase}<p class="text-[12px] text-amber-800">
												This case already runs {selected?.title}. Give this one a label below.
											</p>{/if}
									</div>
								{/if}
							</fieldset>
						{/if}

						{#if target === 'existing' || fixed}
							<div class="grid gap-1.5">
								<label for="label" class="text-[13px] font-medium"
									>Label <span class="font-normal text-muted-foreground"
										>({onCase || fixed?.processes.includes(chosen)
											? 'tells the two apart'
											: 'optional'}, such as “Delivery bill”)</span
									></label
								>
								<input id="label" name="label" class={input} bind:value={label} />
							</div>
						{/if}

						{#if caseRoles.length}
							<fieldset class="grid gap-4">
								<legend class="mb-1 text-[15px] font-semibold">Who’s who on this case</legend>
								{#if caseRoles.some((r) => r.scope !== 'case')}
									<p class="-mt-2 text-[13px] text-muted-foreground">
										Nobody has some of these roles yet, so choose who does them on this case.
									</p>
								{/if}
								{#each caseRoles as role (role.id)}
									<input type="hidden" name="roles" value={role.id} />
									<div class="grid gap-1.5">
										<span class="text-[13px] font-medium">{role.title ?? role.id}</span>
										<div class="flex flex-wrap gap-2">
											{#each data.people as p (p.id)}
												<label
													class="flex cursor-pointer items-center gap-2 rounded-lg border bg-card px-3 py-1.5 text-[13px] has-checked:border-brand has-checked:bg-brand-soft"
												>
													<input
														type="checkbox"
														name="role:{role.id}"
														value={p.id}
														checked={people[role.id]?.includes(p.id) ?? false}
														onchange={(e) => {
															const list = people[role.id] ?? [];
															people[role.id] = e.currentTarget.checked
																? [...list, p.id]
																: list.filter((x) => x !== p.id);
														}}
														class="accent-brand"
													/>
													{p.id === data.user.id ? `${p.name} (you)` : p.name}
												</label>
											{/each}
										</div>
									</div>
								{/each}
								{#if roleProblem}
									<p class="text-[12px] font-medium text-destructive" role="alert">{roleProblem}</p>
								{:else if failure.problems && Object.keys(failure.problems).some( (k) => k.startsWith('role:') )}
									<p class="text-[12px] font-medium text-destructive">{failure.reason}</p>
								{/if}
							</fieldset>
						{/if}

						<div class="flex items-center gap-2">
							{#if !start.process || data.processes.length > 1}
								<button type="button" class={back} onclick={() => (step = 0)}
									><ChevronLeft class="size-4" />Back</button
								>
							{/if}
							<button type="button" class={primary} onclick={next}>Continue</button>
						</div>
					</div>

					<!-- 3. Check, and what happens next -->
					<div class={['grid gap-6', step !== 2 && 'hidden']}>
						<h2 class="text-[17px] font-semibold">Check and start</h2>
						<dl class="divide-y rounded-xl border bg-card text-[13px]">
							<div class="grid gap-1 px-4 py-3 sm:grid-cols-[10rem_minmax(0,1fr)_auto]">
								<dt class="text-muted-foreground">Process</dt>
								<dd class="font-medium">{selected?.title}</dd>
								<button
									type="button"
									class="cursor-pointer justify-self-start text-[12px] text-brand hover:underline"
									onclick={() => (step = 0)}>Change</button
								>
							</div>
							<div class="grid gap-1 px-4 py-3 sm:grid-cols-[10rem_minmax(0,1fr)_auto]">
								<dt class="text-muted-foreground">Case</dt>
								<dd>
									<span class="font-medium">{caseTitle || '—'}</span>
									{#if target === 'new' && subject.trim()}<span class="block text-muted-foreground"
											>{subject}</span
										>{/if}
									{#if target === 'existing' && label.trim()}<span
											class="block text-muted-foreground">Label: {label}</span
										>{/if}
								</dd>
								<button
									type="button"
									class="cursor-pointer justify-self-start text-[12px] text-brand hover:underline"
									onclick={() => (step = 1)}>Change</button
								>
							</div>
							{#each caseRoles as role (role.id)}
								<div class="grid gap-1 px-4 py-3 sm:grid-cols-[10rem_minmax(0,1fr)_auto]">
									<dt class="text-muted-foreground">{role.title ?? role.id}</dt>
									<dd>
										{people[role.id]?.length
											? people[role.id]!.map((id) =>
													id === data.user.id ? 'You' : nameOf(id)
												).join(', ')
											: 'Nobody yet — its work waits until someone is named'}
									</dd>
									<button
										type="button"
										class="cursor-pointer justify-self-start text-[12px] text-brand hover:underline"
										onclick={() => (step = 1)}>Change</button
									>
								</div>
							{/each}
						</dl>

						{#if process}
							<section class="rounded-xl border bg-card px-5 py-4">
								<h3 class="text-[13px] font-semibold">What happens next</h3>
								<div class="mt-3">
									<StageStrip
										stages={process.stages.map((s, i) => ({
											...s,
											state: i === 0 ? 'current' : 'upcoming'
										}))}
									/>
								</div>
								{#if firstStage.length}
									<p class="mt-4 text-[13px] text-muted-foreground">
										The case opens in <span class="font-medium text-foreground"
											>{process.stages[0]?.title}</span
										>:
									</p>
									<ul class="mt-2 grid gap-1.5 text-[13px]">
										{#each firstStage as item (item.id)}
											<li class="flex items-start gap-2">
												<CircleDot class="mt-0.5 size-3.5 shrink-0 text-brand" />
												<span
													>{item.title}
													<span class="text-muted-foreground">— {whoDoes(item.role)}</span></span
												>
											</li>
										{/each}
									</ul>
								{/if}
								<p class="mt-4 text-[13px]">
									{#if goingToFirst && first}
										You’ll go straight to <span class="font-medium">{first.title}</span>.
									{:else}
										Everyone it needs sees their part on My work as the case reaches them.
									{/if}
								</p>
							</section>
						{/if}

						<div class="flex items-center gap-2">
							<button type="button" class={back} onclick={() => (step = 1)}
								><ChevronLeft class="size-4" />Back</button
							>
							<button class={primary} disabled={!chosen}
								>{fixed ? 'Add to case' : 'Start the case'}</button
							>
						</div>
					</div>
				</form>
			</div>
		{/if}
	</div>
</Frame>
