<script lang="ts">
	// Dev sign-in: pick a seeded demo user. No passwords; development only.
	import { enhance } from '$app/forms';
	import Logo from '$lib/editor/Logo.svelte';
	import { CircleAlert, FlaskConical, LogIn } from '@lucide/svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head><title>Sign in · casebook</title></svelte:head>

<div class="flex min-h-dvh items-center justify-center bg-canvas p-6 text-foreground">
	<main class="w-full max-w-md rounded-2xl border bg-background p-6 shadow-sm">
		<div class="mb-5 flex items-center gap-2">
			<Logo /><span class="text-[15px] font-semibold tracking-tight">casebook</span>
		</div>
		<h1 class="text-[17px] font-semibold">Sign in as a demo user</h1>
		<p
			class="mt-2 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900"
		>
			<FlaskConical class="mt-0.5 size-3.5 shrink-0" />Dev sign-in: no passwords, for local
			development only. Every action is checked against the chosen user's roles.
		</p>

		{#if !data.enabled}
			<p class="mt-4 text-[13px] text-muted-foreground">
				Dev sign-in is off in this build. It runs only under <code>pnpm dev</code> and
				<code>pnpm deploy:local</code>.
			</p>
		{:else if data.problem}
			<p class="mt-4 flex items-start gap-2 text-[13px]">
				<CircleAlert class="mt-0.5 size-4 shrink-0 text-destructive" />
				<span
					>The database is not reachable: {data.problem}. Run <code>pnpm db:up</code> and
					<code>pnpm db:seed</code>, then reload.</span
				>
			</p>
		{:else if data.users.length === 0}
			<p class="mt-4 text-[13px] text-muted-foreground">
				No demo users yet. Run <code>pnpm db:seed</code>, then reload.
			</p>
		{:else}
			<form method="POST" action="?/signin" use:enhance class="mt-4 flex flex-col gap-2">
				{#each data.users as user (user.id)}
					<button
						name="user"
						value={user.id}
						class={[
							'flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left hover:border-brand-ring hover:bg-brand-soft/40',
							data.current === user.id && 'border-brand-ring bg-brand-soft/40'
						]}
					>
						<span
							class="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-[12px] font-semibold"
							>{user.displayName
								.split(' ')
								.map((w) => w[0])
								.join('')}</span
						>
						<span class="min-w-0 flex-1">
							<span class="block text-[13.5px] font-medium">{user.displayName}</span>
							<span class="block truncate text-[11.5px] text-muted-foreground"
								>{user.roles.join(' · ') || 'No roles'}</span
							>
						</span>
						<LogIn class="size-4 shrink-0 text-muted-foreground" />
					</button>
				{/each}
			</form>
			{#if form?.reason}<p class="mt-3 text-[12.5px] text-destructive">{form.reason}</p>{/if}
		{/if}
	</main>
</div>
