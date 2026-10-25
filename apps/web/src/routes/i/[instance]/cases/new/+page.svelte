<script lang="ts">
	// Start a published process on a new case, or add it to an existing one, and say who fills
	// the roles that belong to this case.
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
	const initial = () => ({
		process:
			data.processes.find((p) => p.slug === data.preselect || p.id === data.preselect)?.id ??
			(data.processes.length === 1 ? data.processes[0]!.id : ''),
		target: (data.fixedCase ? 'existing' : 'new') as 'new' | 'existing',
		existing: data.fixedCase ?? data.cases[0]?.id ?? ''
	});
	const start = initial();
	let chosen = $state(start.process);
	let target = $state(start.target);
	let existing = $state(start.existing);

	const selected = $derived(data.processes.find((p) => p.id === chosen));
	const process = $derived(selected ? runnableProcess(selected.document) : undefined);
	const first = $derived(process?.items[0]);
	// Roles that belong to this case; those a step fills from what it records are left to it.
	const caseRoles = $derived(
		process
			? [...process.roles.values()].filter(
					(r) =>
						r.scope === 'case' && !process.items.some((i) => i.assigns.some((a) => a.role === r.id))
				)
			: []
	);
	const onCase = $derived(
		target === 'existing' && data.cases.find((c) => c.id === existing)?.processes.includes(chosen)
	);
	const input =
		'h-10 rounded-lg border bg-background px-3 text-[14px] outline-none focus:ring-2 focus:ring-brand-ring';
	const choice =
		'flex cursor-pointer items-start gap-2.5 rounded-lg border bg-background px-3 py-2.5 text-[13px] has-checked:border-brand has-checked:bg-brand-soft';
</script>

<svelte:head><title>{fixed ? `Add a process to ${fixed.title}` : 'New case'}</title></svelte:head>

<Frame
	user={data.user}
	instance={data.instance}
	instances={data.instances}
	crumbs={fixed
		? [{ label: fixed.title, href: links.case(slug, fixed.id) }, { label: 'Add a process' }]
		: [{ label: 'Cases', href: links.cases(slug) }, { label: 'New case' }]}
>
	<div class="mx-auto max-w-2xl px-4 py-8">
		<header class="mb-6 px-1">
			<h1 class="text-[22px] font-semibold tracking-tight">
				{fixed ? `Add a process to ${fixed.title}` : 'Start a case'}
			</h1>
			<p class="mt-1 text-[14px] text-muted-foreground">
				Cases run the latest published version of a process.
			</p>
		</header>

		{#if !data.processes.length}
			<p
				class="rounded-xl border border-dashed bg-card px-5 py-8 text-center text-[13px] text-muted-foreground"
			>
				There is no published process here that you can start. Starting one needs write access, or a
				role in the process.
			</p>
		{:else}
			<form method="POST" class="grid gap-5">
				{#if failure.reason}<p class="text-[13px] font-medium text-destructive" role="alert">
						{failure.reason}
					</p>{/if}
				<input type="hidden" name="processTitle" value={selected?.title ?? ''} />

				<fieldset class="grid gap-2 rounded-xl border bg-card px-5 py-5">
					<legend class="sr-only">Process</legend>
					<h2 class="mb-1 text-[13px] font-semibold">What do you want to run?</h2>
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
							<span>
								<span class="font-medium">{p.title}</span>
								{#if fixed?.processes.includes(p.id)}<span
										class="ml-1 text-[12px] text-muted-foreground"
										>· already on this case (add another)</span
									>{/if}
								{#if summary}<span class="block text-[12px] text-muted-foreground">{summary}</span
									>{/if}
							</span>
						</label>
					{/each}
				</fieldset>

				{#if process}
					<div class="rounded-xl border bg-card px-5 py-4">
						<StageStrip
							stages={process.stages.map((s, i) => ({
								...s,
								state: i === 0 ? 'current' : 'upcoming'
							}))}
						/>
						{#if first}
							<p class="mt-3 text-[13px] text-muted-foreground">
								First step: <span class="text-foreground">{first.title}</span>, done by the {lowerFirst(
									process.roles.get(first.role)?.title ?? first.role
								)}.
							</p>
						{/if}
					</div>
				{/if}

				{#if fixed}
					<input type="hidden" name="target" value="existing" />
					<input type="hidden" name="existing" value={fixed.id} />
				{:else}
					<fieldset class="grid gap-2 rounded-xl border bg-card px-5 py-5">
						<legend class="sr-only">Case</legend>
						<h2 class="mb-1 text-[13px] font-semibold">Which case is it for?</h2>
						<label class={choice}>
							<input
								type="radio"
								name="target"
								bind:group={target}
								value="new"
								class="mt-0.5 accent-brand"
							/>
							<span
								><span class="font-medium">Someone or something new</span><span
									class="block text-[12px] text-muted-foreground"
									>Such as a new incident or a new family member.</span
								></span
							>
						</label>
						<label class={choice}>
							<input
								type="radio"
								name="target"
								bind:group={target}
								value="existing"
								class="mt-0.5 accent-brand"
								disabled={!data.cases.length}
							/>
							<span
								><span class="font-medium">An existing case</span><span
									class="block text-[12px] text-muted-foreground"
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
									placeholder="e.g. INC-2044 Payments timeouts"
								/>
								{#if failure.problems?.title}<p class="text-[12px] font-medium text-destructive">
										{failure.problems.title}
									</p>{/if}
							</div>
							<div class="grid gap-1.5">
								<label for="subject" class="text-[13px] font-medium"
									>What it’s about <span class="font-normal text-muted-foreground">(optional)</span
									></label
								>
								<input id="subject" name="subject" class={input} />
							</div>
						{:else}
							<div class="mt-2 grid gap-1.5">
								<label for="existing" class="text-[13px] font-medium">Case</label>
								<select id="existing" name="existing" class={input} bind:value={existing}>
									{#each data.cases as c (c.id)}<option value={c.id}>{c.title}</option>{/each}
								</select>
							</div>
						{/if}
					</fieldset>
				{/if}

				{#if target === 'existing' || fixed}
					<div class="grid gap-1.5 px-1">
						<label for="label" class="text-[13px] font-medium"
							>Label <span class="font-normal text-muted-foreground"
								>({onCase || fixed?.processes.includes(chosen)
									? 'tells the two runs apart'
									: 'optional'}, such as “Delivery bill”)</span
							></label
						>
						<input id="label" name="label" class={input} />
					</div>
				{/if}

				{#if caseRoles.length}
					<fieldset class="grid gap-4 rounded-xl border bg-card px-5 py-5">
						<legend class="sr-only">Who’s who</legend>
						<h2 class="-mb-1 text-[13px] font-semibold">Who’s who on this case</h2>
						{#each caseRoles as role (role.id)}
							<input type="hidden" name="roles" value={role.id} />
							<div class="grid gap-1.5">
								<span class="text-[13px] font-medium">{role.title ?? role.id}</span>
								<div class="flex flex-wrap gap-2">
									{#each data.people as p (p.id)}
										<label
											class="flex cursor-pointer items-center gap-2 rounded-lg border bg-background px-3 py-1.5 text-[13px] has-checked:border-brand has-checked:bg-brand-soft"
										>
											<input
												type="checkbox"
												name="role:{role.id}"
												value={p.id}
												checked={first?.role === role.id && p.id === data.user.id}
												class="accent-brand"
											/>
											{p.id === data.user.id ? `${p.name} (you)` : p.name}
										</label>
									{/each}
								</div>
							</div>
						{/each}
						{#if failure.problems && Object.keys(failure.problems).some( (k) => k.startsWith('role:') )}
							<p class="text-[12px] font-medium text-destructive">{failure.reason}</p>
						{/if}
					</fieldset>
				{/if}

				<div class="flex items-center gap-3">
					<button
						class="h-10 cursor-pointer rounded-lg bg-foreground px-5 text-[14px] font-medium text-background hover:bg-foreground/90 disabled:opacity-50"
						disabled={!chosen}>{fixed ? 'Add to case' : 'Start'}</button
					>
					<a
						href={fixed ? links.case(slug, fixed.id) : links.cases(slug)}
						class="text-[13px] text-muted-foreground hover:text-foreground">Cancel</a
					>
				</div>
			</form>
		{/if}
	</div>
</Frame>
