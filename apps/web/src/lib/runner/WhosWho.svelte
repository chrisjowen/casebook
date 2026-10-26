<script lang="ts">
	// Who's who on a case: each role its processes declare and who holds it. A role nobody holds
	// stands out with the work waiting on it. Owners and admins can name, replace or remove the
	// people holding a role on this case; everyone else reads it.
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Pencil from '@lucide/svelte/icons/pencil';
	import type { CaseRole, PersonView } from '@casebook/store';
	import { names } from './format';
	import { links } from './links';

	let {
		roles,
		people = [],
		me,
		instance,
		caseId,
		editable = false,
		problem
	}: {
		roles: CaseRole[];
		/** Everyone who can be named, for an owner or admin. */
		people?: PersonView[];
		me: string;
		instance: string;
		caseId: string;
		editable?: boolean;
		/** Why the last change was refused, and for which role. */
		problem?: { role: string; reason: string };
	} = $props();

	// A refused change reopens its role's form, with the reason under it.
	let editing = $state<string | undefined>(untrack(() => problem?.role));
	let saving = $state(false);
	const label = (p: PersonView) => (p.id === me ? `${p.name} (you)` : p.name);
	// Someone named on the case who no longer appears among the people still shows, to be removed.
	const choices = (role: CaseRole) => [
		...people,
		...role.holders.filter((h) => !people.some((p) => p.id === h.id))
	];
	const holderLine = (role: CaseRole) => names([...role.holders, ...role.standing]);
	$effect(() => {
		if (problem) editing = problem.role;
	});
</script>

<section class="mt-8" aria-labelledby="whos-who">
	<div class="mb-2 flex items-baseline px-1">
		<h2 id="whos-who" class="text-[13px] font-semibold">Who’s who</h2>
		{#if editable}
			<span class="ml-auto text-[12px] text-muted-foreground">Changes show in the case record.</span
			>
		{/if}
	</div>
	<ul class="divide-y rounded-xl border bg-card">
		{#each roles as role (role.id)}
			{@const nobody = role.holders.length === 0 && role.standing.length === 0}
			<li
				class={['px-4 py-3 text-[13px]', nobody && role.work.length > 0 && 'bg-amber-50/60']}
				data-role={role.id}
			>
				<div class="flex flex-wrap items-start gap-x-4 gap-y-1">
					<div class="min-w-0 flex-1">
						<p class="text-muted-foreground">{role.title}</p>
						{#if nobody}
							<p
								class={[
									'font-medium',
									role.work.length ? 'flex items-center gap-1.5 text-amber-800' : ''
								]}
							>
								{#if role.work.length}<CircleAlert class="size-3.5 shrink-0" />{/if}
								Nobody yet
							</p>
						{:else}
							<p class="font-medium">{holderLine(role)}</p>
							{#if role.standing.length}
								<p class="text-[12px] text-muted-foreground">
									{names(role.standing)}
									{role.standing.length === 1 ? 'holds' : 'hold'} it across the workspace
								</p>
							{/if}
						{/if}
						{#if nobody && role.work.length}
							<p class="mt-1 text-[12px] text-amber-800">
								Waiting on someone in this role:
								{#each role.work as w, i (w.attachmentId + w.item)}{i > 0 ? '; ' : ''}<a
										href={links.task(instance, caseId, w.attachmentId, w.item)}
										class="underline-offset-2 hover:underline">{w.title}</a
									>
									<span class="text-amber-800/80">({w.process})</span>{/each}
							</p>
						{/if}
					</div>
					{#if editable && editing !== role.id}
						<button
							type="button"
							class="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground"
							aria-label="Change who is {role.title}"
							onclick={() => (editing = role.id)}
							><Pencil class="size-3.5" />{nobody ? 'Name someone' : 'Change'}</button
						>
					{/if}
				</div>

				{#if editable && editing === role.id}
					<form
						method="POST"
						action="?/roles"
						class="mt-3 grid gap-3"
						use:enhance={() => {
							saving = true;
							return async ({ result, update }) => {
								await update();
								saving = false;
								if (result.type === 'success') editing = undefined;
							};
						}}
					>
						<input type="hidden" name="role" value={role.id} />
						<fieldset class="flex flex-wrap gap-2">
							<legend class="sr-only">Who is {role.title} on this case</legend>
							{#each choices(role) as p (p.id)}
								<label
									class="flex cursor-pointer items-center gap-2 rounded-lg border bg-background px-3 py-1.5 text-[13px] has-checked:border-brand has-checked:bg-brand-soft"
								>
									<input
										type="checkbox"
										name="holder"
										value={p.id}
										checked={role.holders.some((h) => h.id === p.id)}
										class="accent-brand"
									/>
									{label(p)}
								</label>
							{/each}
						</fieldset>
						{#if role.standing.length}
							<p class="text-[12px] text-muted-foreground">
								{names(role.standing)}
								{role.standing.length === 1 ? 'holds' : 'hold'} it across the workspace, which this case
								cannot change.
							</p>
						{/if}
						{#if problem?.role === role.id}
							<p class="text-[12px] font-medium text-destructive" role="alert">{problem.reason}</p>
						{/if}
						<div class="flex items-center gap-2">
							<button
								type="submit"
								disabled={saving}
								class="h-8 cursor-pointer rounded-lg bg-foreground px-3 text-[13px] font-medium text-background hover:bg-foreground/90 disabled:opacity-60"
								>Save</button
							>
							<button
								type="button"
								class="h-8 cursor-pointer rounded-lg px-3 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground"
								onclick={() => (editing = undefined)}>Cancel</button
							>
						</div>
					</form>
				{/if}
			</li>
		{/each}
	</ul>
</section>
