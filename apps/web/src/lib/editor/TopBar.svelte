<script lang="ts">
	import { resolve } from '$app/paths';
	import Logo from './Logo.svelte';
	import { ChevronRight, FlaskConical, LogOut, Search } from '@lucide/svelte';
	import { links } from '$lib/runner/links';

	let {
		query = $bindable(''),
		user,
		instance
	}: {
		query?: string;
		/** The signed-in user, shown with their roles and a way to switch. */
		user?: { displayName: string; roles: string[] };
		/** The instance the editor belongs to, inside its Processes half. */
		instance?: { slug: string; name: string };
	} = $props();
	let input = $state<HTMLInputElement>();
</script>

<svelte:window
	onkeydown={(e) => {
		if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
			e.preventDefault();
			input?.focus();
		}
	}}
/>
<header
	class="grid h-14 shrink-0 grid-cols-[1fr_minmax(0,440px)_1fr] items-center gap-4 border-b bg-background px-4"
>
	<div class="flex min-w-0 items-center gap-1.5 text-[13px]">
		<a href={resolve('/')} class="flex shrink-0 items-center gap-2"
			><Logo /><span class="text-[15px] font-semibold tracking-tight max-lg:hidden">casebook</span
			></a
		>
		{#if instance}
			<ChevronRight class="size-3.5 shrink-0 text-muted-foreground/60" />
			<a
				href={links.processes(instance.slug)}
				class="truncate rounded-md px-1.5 py-1 text-muted-foreground hover:bg-muted hover:text-foreground"
				>{instance.name} · Processes</a
			>
		{/if}
	</div>
	<label
		class="flex h-9 items-center gap-2 rounded-xl bg-muted/80 px-3 text-[13px] text-muted-foreground focus-within:ring-2 focus-within:ring-brand-ring"
	>
		<Search class="size-4 shrink-0" />
		<input
			bind:this={input}
			bind:value={query}
			placeholder="Search steps, facts, processes"
			aria-label="Search"
			class="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
		/>
		<kbd class="rounded-md border bg-background px-1.5 text-[11px]">⌘K</kbd>
	</label>
	<div class="flex min-w-0 items-center justify-end gap-2">
		{#if instance}
			<nav
				aria-label="Work or processes"
				class="flex shrink-0 items-center rounded-lg border bg-muted p-0.5 text-[13px]"
			>
				<a
					href={links.myWork(instance.slug)}
					class="rounded-md px-3 py-0.5 text-muted-foreground hover:text-foreground">Work</a
				>
				<a
					href={links.processes(instance.slug)}
					aria-current="page"
					class="rounded-md bg-background px-3 py-0.5 font-medium shadow-sm">Processes</a
				>
			</nav>
		{/if}
		{#if user}
			<a
				href={resolve('/signin')}
				class="flex min-w-0 items-center gap-2 rounded-xl px-2 py-1 hover:bg-muted"
				title="Signed in as {user.displayName} ({user.roles.join(', ') ||
					'no roles'}). Dev sign-in: switch user."
			>
				<span
					class="inline-flex shrink-0 items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[10.5px] font-medium text-amber-900"
					><FlaskConical class="size-3" />Dev sign-in</span
				>
				<span class="min-w-0 text-right leading-tight">
					<span class="block truncate text-[12.5px] font-medium">{user.displayName}</span>
					<span class="block truncate text-[11px] text-muted-foreground"
						>{user.roles[0] ?? 'No roles'}{user.roles.length > 1
							? ` +${user.roles.length - 1}`
							: ''}</span
					>
				</span>
			</a>
			<form method="POST" action="{resolve('/signin')}?/signout">
				<button
					class="flex size-8 cursor-pointer items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
					title="Sign out"
					aria-label="Sign out"><LogOut class="size-4" /></button
				>
			</form>
		{/if}
	</div>
</header>
