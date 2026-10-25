<script lang="ts">
	// Shared lookups (ADR 0025): lists of values a whole workspace's processes choose from, such as
	// countries or insurers. The workspaces and their lookups on the left; the open lookup on the
	// right, with its values edited in place, the processes and facts that use it, and its history.
	// Every saved change is a new version that processes see straight away, and Undo takes it back.
	import { deserialize } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import type { LookupList, ValuesEdit } from '@casebook/model';
	import {
		ArrowUpRight,
		CircleAlert,
		CircleCheck,
		FolderTree,
		History,
		ListChecks,
		Plus,
		Trash2,
		Undo2,
		Workflow,
		X
	} from '@lucide/svelte';
	import Frame from '$lib/runner/Frame.svelte';
	import { relative, when } from '$lib/runner/format';
	import { links } from '$lib/runner/links';
	import LookupValues from '$lib/lookups/LookupValues.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const slug = $derived(data.instance.slug);
	const open = $derived(data.open);
	const writable = $derived(data.groups.filter((g) => g.canEdit.allowed));
	const total = $derived(data.groups.reduce((n, g) => n + g.lookups.length, 0));

	let notice = $state<{ tone: 'info' | 'error'; text: string; undo?: boolean } | undefined>();
	let timer: ReturnType<typeof setTimeout> | undefined;
	let creatingIn = $state<string | undefined>();
	let confirmDelete = $state(false);

	function say(tone: 'info' | 'error', text: string, undo = false) {
		clearTimeout(timer);
		notice = { tone, text, ...(undo ? { undo } : {}) };
		if (tone === 'info') timer = setTimeout(() => (notice = undefined), 6000);
	}

	async function post(action: string, fields: Record<string, string>) {
		const body = new FormData();
		for (const [key, value] of Object.entries(fields)) body.set(key, value);
		const response = await fetch(`?/${action}`, {
			method: 'POST',
			body,
			headers: { 'x-sveltekit-action': 'true' }
		});
		const result = deserialize(await response.text());
		if (result.type === 'success') {
			await invalidateAll();
			return true;
		}
		if (result.type === 'redirect') {
			location.href = result.location;
			return true;
		}
		const reason =
			result.type === 'failure'
				? String((result.data as { reason?: string } | undefined)?.reason ?? 'That did not work')
				: 'Something went wrong';
		say('error', reason);
		return false;
	}

	/** Saves a change to the open lookup as its next version. */
	async function save(
		changes: Partial<Omit<LookupList, 'content'>> & { content?: string | null },
		label: string
	) {
		if (!open) return false;
		const ok = await post('edit', {
			lookupId: open.id,
			baseVersion: String(open.version),
			changes: JSON.stringify(changes)
		});
		if (ok) say('info', label, true);
		return ok;
	}

	const saveValues = async (next: ValuesEdit) => {
		if (typeof next === 'string') {
			say('error', next);
			return false;
		}
		return save(
			{ values: next },
			open?.uses.length
				? `Saved. ${open.uses.length === 1 ? 'Its process now offers' : `All ${open.uses.length} processes using it now offer`} these values.`
				: 'Saved.'
		);
	};

	async function undo() {
		if (!open) return;
		if (await post('undo', { lookupId: open.id, baseVersion: String(open.version) })) {
			say('info', 'Undid the last change');
		}
	}

	async function rename(field: HTMLInputElement) {
		const title = field.value.trim();
		if (!open || title === open.title) return;
		if (!title || !(await save({ title }, `Renamed to ${title}`))) field.value = open.title;
	}
	async function guide(field: HTMLTextAreaElement) {
		const text = field.value.trim();
		if (!open || text === (open.content ?? '')) return;
		await save({ content: text || null }, 'Saved the guidance');
	}
	const canEdit = $derived(open?.canEdit.allowed ?? false);
</script>

<svelte:head
	><title>{open ? `${open.title} · ` : ''}Lookups · {data.instance.name}</title></svelte:head
>

<Frame
	user={data.user}
	instance={data.instance}
	instances={data.instances}
	mode="processes"
	crumbs={[{ label: 'Processes', href: links.processes(slug) }, { label: 'Lookups' }]}
>
	<div class="flex min-h-[calc(100dvh-3.5rem)] flex-col md:flex-row">
		<aside
			class="shrink-0 border-b bg-background md:w-80 md:border-r md:border-b-0"
			aria-label="Shared lookups"
		>
			<div class="px-4 pt-5 pb-3">
				<h1 class="text-[17px] font-semibold tracking-tight">Lookups</h1>
				<p class="mt-1 text-[12.5px] text-muted-foreground">
					Lists of values that choices are made from, kept for a whole workspace and every process
					in it, such as countries or insurers.
				</p>
			</div>
			<nav class="flex flex-col gap-4 px-2 pb-6">
				{#each data.groups as group (group.id)}
					{#if group.lookups.length || group.canEdit.allowed}
						<section>
							<h2
								class="flex items-center gap-1.5 px-2 pb-1 text-[11.5px] font-semibold text-muted-foreground"
							>
								<FolderTree class="size-3.5" />{group.label}
								<span class="truncate font-mono text-[10.5px] font-normal text-muted-foreground/70"
									>{group.namespace}</span
								>
								{#if group.canEdit.allowed}
									<button
										class="ml-auto flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md hover:bg-muted hover:text-foreground"
										aria-label="New lookup in {group.label}"
										title="New lookup in {group.label}"
										aria-expanded={creatingIn === group.id}
										onclick={() => (creatingIn = creatingIn === group.id ? undefined : group.id)}
										><Plus class="size-3.5" /></button
									>
								{/if}
							</h2>
							<ul class="flex flex-col">
								{#each group.lookups as l (l.id)}
									<li>
										<a
											href={links.lookups(slug, l.id)}
											aria-current={open?.id === l.id ? 'page' : undefined}
											class={[
												'flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px]',
												open?.id === l.id
													? 'bg-brand-soft font-medium text-foreground'
													: 'text-foreground/85 hover:bg-muted'
											]}
										>
											<ListChecks
												class={[
													'size-3.5 shrink-0',
													open?.id === l.id ? 'text-brand' : 'text-muted-foreground'
												]}
											/>
											<span class="min-w-0 flex-1 truncate">{l.title}</span>
											<span class="shrink-0 text-[11px] text-muted-foreground tabular-nums"
												>{l.count}</span
											>
										</a>
									</li>
								{/each}
							</ul>
							{#if creatingIn === group.id}
								<form
									method="POST"
									action="?/create"
									class="mx-1 mt-1 flex items-center gap-1.5 rounded-lg border border-dashed px-2 focus-within:border-solid focus-within:border-brand-ring"
								>
									<input type="hidden" name="namespaceId" value={group.id} />
									<!-- svelte-ignore a11y_autofocus -->
									<input
										name="title"
										class="h-8 min-w-0 flex-1 bg-transparent px-1 text-[13px] outline-none placeholder:text-muted-foreground"
										placeholder="Name, such as Insurers"
										aria-label="Name of the new lookup"
										required
										autofocus
									/>
									<button
										class="h-7 shrink-0 cursor-pointer rounded-md px-2 text-[12px] font-medium text-brand hover:bg-brand-soft"
										>Make</button
									>
								</form>
							{/if}
						</section>
					{/if}
				{/each}
				{#if data.inProcesses.length}
					<section>
						<h2
							class="flex items-center gap-1.5 px-2 pb-1 text-[11.5px] font-semibold text-muted-foreground"
						>
							<Workflow class="size-3.5" />Kept in a process
						</h2>
						<ul class="flex flex-col">
							{#each data.inProcesses as l (`${l.slug}:${l.id}`)}
								<li>
									<a
										href={links.editor(slug, l.namespace, l.slug, l.id)}
										class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-foreground/85 hover:bg-muted"
										title="Opens in the editor of {l.process}"
									>
										<ListChecks class="size-3.5 shrink-0 text-muted-foreground" />
										<span class="min-w-0 flex-1 truncate"
											>{l.title}<span class="ml-1.5 text-[11.5px] text-muted-foreground"
												>{l.process}</span
											></span
										>
										<span class="shrink-0 text-[11px] text-muted-foreground tabular-nums"
											>{l.count}</span
										>
									</a>
								</li>
							{/each}
						</ul>
					</section>
				{/if}
				{#if total === 0 && writable.length === 0}
					<p class="px-2 text-[12.5px] text-muted-foreground">
						No shared lookups yet, and you cannot make them here. Ask someone with write access to a
						workspace.
					</p>
				{/if}
			</nav>
		</aside>

		<main class="min-w-0 flex-1 px-4 py-6 md:px-8">
			{#if notice}
				<div
					role={notice.tone === 'error' ? 'alert' : 'status'}
					class={[
						'fixed top-16 left-1/2 z-50 flex w-[min(560px,calc(100%-32px))] -translate-x-1/2 items-start gap-2 rounded-xl border bg-background px-3.5 py-2.5 text-[12.5px] shadow-md',
						notice.tone === 'error' && 'border-destructive/40'
					]}
				>
					{#if notice.tone === 'error'}<CircleAlert
							class="mt-0.5 size-3.5 shrink-0 text-destructive"
						/>{:else}<CircleCheck class="mt-0.5 size-3.5 shrink-0 text-emerald-600" />{/if}
					<p class="min-w-0 flex-1">{notice.text}</p>
					{#if notice.undo && canEdit}
						<button
							class="-my-1 inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-lg px-2 py-1 font-medium text-brand hover:bg-brand-soft"
							onclick={undo}><Undo2 class="size-3.5" />Undo</button
						>
					{/if}
					<button
						class="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
						aria-label="Dismiss"
						onclick={() => (notice = undefined)}><X class="size-3.5" /></button
					>
				</div>
			{/if}

			{#if open}
				{#key open.id}
					<header class="flex flex-wrap items-start gap-x-6 gap-y-2">
						<div class="min-w-0 flex-1">
							{#if canEdit}
								<input
									class="-mx-2 w-full rounded-lg bg-transparent px-2 py-0.5 text-[22px] font-semibold tracking-tight outline-none hover:bg-muted/60 focus:bg-background focus:ring-2 focus:ring-brand-ring"
									value={open.title}
									aria-label="Name of the lookup"
									onchange={(e) => rename(e.currentTarget)}
									onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
								/>
							{:else}
								<h2 class="text-[22px] font-semibold tracking-tight">{open.title}</h2>
							{/if}
							<p class="mt-1 text-[12.5px] text-muted-foreground">
								Shared by every process in {open.namespaceLabel}
								<span class="font-mono text-[11px]">({open.namespace})</span> and below.
								{#if canEdit}Changes go live for them as soon as you make them.{/if}
							</p>
						</div>
						<div class="flex shrink-0 items-center gap-2 pt-1 text-[12px] text-muted-foreground">
							<span title={when(open.updatedAt)}
								>Version {open.version} · changed by {open.updatedBy}
								{relative(open.updatedAt)}</span
							>
						</div>
					</header>
					{#if !canEdit}
						<p
							class="mt-3 max-w-3xl rounded-lg bg-muted/60 px-3 py-2 text-[12px] text-muted-foreground"
						>
							You can view this list. To change it, ask someone who can edit processes in {open.namespaceLabel}.
						</p>
					{/if}

					<div class="mt-6 grid gap-8 xl:grid-cols-[minmax(0,1fr)_340px]">
						<section aria-labelledby="values-heading" class="max-w-3xl min-w-0">
							<h3
								id="values-heading"
								class="mb-2 text-[11px] font-semibold tracking-wide text-foreground/70 uppercase"
							>
								Values
							</h3>
							<LookupValues
								values={open.values}
								onchange={canEdit ? saveValues : undefined}
								confirmRemove={(v) =>
									confirm(
										`Take “${v.label ?? v.value}” out of ${open.title}? Cases that already hold it keep it, but no process offers it any more. To stop offering it but keep it listed, turn it off instead.`
									)}
							/>
							<p class="mt-2 text-[11.5px] text-muted-foreground">
								Renaming a value keeps what cases already hold. Turn a value off to stop offering it
								without changing cases that have it.
							</p>
							<label class="mt-6 flex flex-col gap-1.5">
								<span class="text-[11px] font-semibold tracking-wide text-foreground/70 uppercase"
									>Guidance</span
								>
								{#if canEdit}
									<textarea
										class="min-h-[72px] w-full resize-y rounded-lg bg-muted/70 px-3 py-2 text-[13px] outline-none placeholder:text-muted-foreground focus:bg-background focus:ring-2 focus:ring-brand-ring disabled:opacity-70"
										placeholder={canEdit ? 'What these values mean, for whoever chooses one' : ''}
										disabled={!canEdit}
										value={open.content ?? ''}
										onchange={(e) => guide(e.currentTarget)}></textarea>
								{:else}
									<p class="text-[13px] text-foreground/85">{open.content || 'No guidance yet.'}</p>
								{/if}
							</label>
						</section>

						<div class="flex min-w-0 flex-col gap-8">
							<section aria-labelledby="uses-heading">
								<h3
									id="uses-heading"
									class="mb-2 flex items-center gap-2 text-[11px] font-semibold tracking-wide text-foreground/70 uppercase"
								>
									Used by<span
										class="rounded-md bg-muted px-1.5 text-[11px] font-normal text-muted-foreground"
										>{open.uses.length}</span
									>
								</h3>
								<ul class="flex flex-col gap-1.5">
									{#each open.uses as u (u.definitionId)}
										<li class="rounded-lg border bg-background px-3 py-2">
											<a
												href={links.process(slug, u.slug)}
												class="flex items-center gap-1 text-[13px] font-medium hover:underline"
												>{u.title}<ArrowUpRight class="size-3 text-muted-foreground" /></a
											>
											<p class="mt-0.5 text-[11.5px] text-muted-foreground">
												{#each u.facts as f, i (f.id)}{i ? ', ' : ''}<a
														class="underline-offset-2 hover:text-foreground hover:underline"
														href={links.editor(slug, u.namespace, u.slug, { select: f.id })}>{f.title}</a
													>{/each}{u.draftOnly ? ' · in its draft only' : ''}
											</p>
										</li>
									{:else}
										<li class="text-[12.5px] text-muted-foreground">
											No process chooses from it yet. In the editor, pick it as a fact’s kind in a
											step’s Records.
										</li>
									{/each}
								</ul>
							</section>

							<section aria-labelledby="history-heading">
								<h3
									id="history-heading"
									class="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-foreground/70 uppercase"
								>
									<History class="size-3.5" />History
								</h3>
								<ol class="flex flex-col gap-2 border-l pl-3">
									{#each open.history.slice(0, 8) as v (v.version)}
										<li class="text-[12px]">
											<p class="text-muted-foreground">
												<span class="font-medium text-foreground">Version {v.version}</span> ·
												{v.byName} · <span title={when(v.at)}>{relative(v.at)}</span>
											</p>
											{#each v.summary as line, i (i)}<p class="text-foreground/85">
													{line}
												</p>{/each}
										</li>
									{/each}
								</ol>
								{#if canEdit && open.version > 1}
									<button
										class="mt-3 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] hover:bg-muted"
										onclick={undo}><Undo2 class="size-3.5" />Undo the last change</button
									>
								{/if}
							</section>

							{#if canEdit}
								<section class="border-t pt-4">
									{#if open.uses.length}
										<p class="text-[11.5px] text-muted-foreground">
											It cannot be deleted while processes choose from it.
										</p>
									{:else if confirmDelete}
										<form method="POST" action="?/delete" class="flex items-center gap-2">
											<input type="hidden" name="lookupId" value={open.id} />
											<span class="text-[12px]">Delete {open.title} and its history?</span>
											<button
												class="h-7 cursor-pointer rounded-md bg-destructive px-2.5 text-[12px] font-medium text-white hover:opacity-90"
												>Delete</button
											>
											<button
												type="button"
												class="h-7 cursor-pointer rounded-md px-2 text-[12px] text-muted-foreground hover:bg-muted"
												onclick={() => (confirmDelete = false)}>Cancel</button
											>
										</form>
									{:else}
										<button
											class="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] text-destructive hover:bg-destructive/5"
											onclick={() => (confirmDelete = true)}
											><Trash2 class="size-3.5" />Delete this lookup</button
										>
									{/if}
								</section>
							{/if}
						</div>
					</div>
				{/key}
			{:else}
				<div class="max-w-xl py-10">
					<ListChecks class="size-6 text-muted-foreground" />
					<h2 class="mt-3 text-[16px] font-semibold">
						{total ? 'Choose a lookup' : 'No shared lookups yet'}
					</h2>
					<p class="mt-1 text-[13px] text-muted-foreground">
						{total
							? 'Pick one on the left to see and change its values.'
							: writable.length
								? 'Use + beside a workspace to make one. Its processes can then choose from it.'
								: 'Shared lookups appear here once someone with write access makes one.'}
					</p>
					<p class="mt-3 text-[12.5px] text-muted-foreground">
						A list that only one process needs can live in the process itself: open it in the editor
						and choose Lookups.
					</p>
				</div>
			{/if}
		</main>
	</div>
</Frame>
