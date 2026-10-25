<script lang="ts" module>
	import type { ResolvedPathname } from '$app/types';

	export interface Crumb {
		label: string;
		href?: ResolvedPathname;
		/** Small muted prefix, such as the process name before a stage. */
		hint?: string;
	}

	export interface Tab {
		label: string;
		href: ResolvedPathname;
		active: boolean;
		count?: number;
	}
</script>

<script lang="ts">
	// The runner's frame: the instance switcher (the top-level scope, like Figma's account
	// switcher), a breadcrumb for case and task, the Work | Processes switch, and the user menu.
	// Guests get none of the switching: only their requests.
	import type { Snippet } from 'svelte';
	import { DropdownMenu } from 'bits-ui';
	import { Check, ChevronsUpDown, FlaskConical, LogOut, Slash, UserRound } from '@lucide/svelte';
	import type { Instance } from '@casebook/store';
	import Logo from '$lib/editor/Logo.svelte';
	import { links } from './links';

	let {
		user,
		instance,
		instances = [],
		mode = 'work',
		crumbs = [],
		tabs,
		children
	}: {
		user: { displayName: string; roles: string[] };
		/** Unset on a guest's requests pages. */
		instance?: Instance;
		instances?: Instance[];
		/** Which half of the instance the page belongs to: running work or designing processes. */
		mode?: 'work' | 'processes';
		crumbs?: Crumb[];
		tabs?: Tab[];
		children: Snippet;
	} = $props();

	const mark = (name: string) =>
		name
			.split(/\s+/)
			.map((w) => w[0])
			.join('')
			.slice(0, 2)
			.toUpperCase();
	const initials = $derived(mark(user.displayName));

	const itemClass =
		'flex cursor-pointer items-start gap-3 rounded-lg px-2.5 py-2 text-[13px] outline-none data-highlighted:bg-muted';
	const contentClass =
		'z-50 min-w-64 rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-lg shadow-black/5';
</script>

<div class="flex min-h-dvh flex-col bg-canvas">
	<header class="sticky top-0 z-40 border-b bg-background">
		<div class="flex h-14 items-center gap-1 px-4">
			<a
				href={instance ? links.myWork(instance.slug) : links.requests()}
				class="mr-1.5 shrink-0"
				aria-label="casebook home"><Logo /></a
			>

			{#if instance}
				<DropdownMenu.Root>
					<DropdownMenu.Trigger
						class="flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-lg px-2 text-[14px] font-medium hover:bg-muted data-[state=open]:bg-muted"
					>
						<span
							class="grid size-6 place-items-center rounded-md bg-brand text-[10px] font-semibold text-white"
							>{mark(instance.name)}</span
						>
						<span class="max-sm:hidden">{instance.name}</span>
						<ChevronsUpDown class="size-3.5 text-muted-foreground" />
					</DropdownMenu.Trigger>
					<DropdownMenu.Portal>
						<DropdownMenu.Content class={contentClass} align="start" sideOffset={6}>
							<DropdownMenu.Group>
								<DropdownMenu.GroupHeading
									class="px-2.5 pt-1.5 pb-1 text-[11px] font-medium text-muted-foreground"
									>Casebooks you belong to</DropdownMenu.GroupHeading
								>
								{#each instances as inst (inst.slug)}
									<DropdownMenu.Item
										class={itemClass}
										onSelect={() => (location.href = links.myWork(inst.slug))}
									>
										<span
											class="grid size-7 shrink-0 place-items-center rounded-md bg-brand text-[10px] font-semibold text-white"
											>{mark(inst.name)}</span
										>
										<span class="min-w-0 flex-1">
											<span class="block font-medium">{inst.name}</span>
											<span class="block text-[12px] text-muted-foreground">
												{inst.waitingOnYou
													? `${inst.waitingOnYou} waiting on you`
													: 'Nothing waiting on you'}
											</span>
										</span>
										{#if inst.slug === instance.slug}<Check class="mt-1.5 size-4 text-brand" />{/if}
									</DropdownMenu.Item>
								{/each}
							</DropdownMenu.Group>
						</DropdownMenu.Content>
					</DropdownMenu.Portal>
				</DropdownMenu.Root>
			{:else}
				<a
					href={links.requests()}
					class="rounded-lg px-2 py-1.5 text-[14px] font-medium hover:bg-muted">Requests for you</a
				>
			{/if}

			<nav aria-label="Breadcrumb" class="min-w-0 flex-1">
				<ol class="flex min-w-0 items-center gap-1 text-[14px]">
					{#each crumbs as crumb, i (i)}
						{@const last = i === crumbs.length - 1}
						<li class="flex min-w-0 items-center gap-1">
							<Slash class="size-3.5 shrink-0 -rotate-12 text-border" aria-hidden="true" />
							{#if crumb.href && !last}
								<a
									href={crumb.href}
									class="truncate rounded-md px-1.5 py-1 text-muted-foreground hover:bg-muted hover:text-foreground"
									>{#if crumb.hint}<span class="mr-1 text-muted-foreground/70"
											>{`${crumb.hint} ·`}</span
										>{/if}{crumb.label}</a
								>
							{:else}
								<span
									class={['truncate px-1.5 py-1', last ? 'font-medium' : 'text-muted-foreground']}
									aria-current={last ? 'page' : undefined}
									>{#if crumb.hint}<span class="mr-1 font-normal text-muted-foreground"
											>{`${crumb.hint} ·`}</span
										>{/if}{crumb.label}</span
								>
							{/if}
						</li>
					{/each}
				</ol>
			</nav>

			{#if instance}
				<nav
					aria-label="Work or processes"
					class="mr-3 flex shrink-0 items-center rounded-lg border bg-muted p-0.5 text-[14px]"
				>
					{#each [{ id: 'work', label: 'Work', href: links.myWork(instance.slug) }, { id: 'processes', label: 'Processes', href: links.processes(instance.slug) }] as m (m.id)}
						<a
							href={m.href}
							aria-current={mode === m.id ? 'page' : undefined}
							class={[
								'rounded-md px-3.5 py-1 transition-colors',
								mode === m.id
									? 'bg-background font-medium text-foreground shadow-sm'
									: 'text-muted-foreground hover:text-foreground'
							]}>{m.label}</a
						>
					{/each}
				</nav>
			{/if}

			<DropdownMenu.Root>
				<DropdownMenu.Trigger
					class="flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-lg pr-2 pl-1 hover:bg-muted data-[state=open]:bg-muted"
					aria-label="Signed in as {user.displayName}"
				>
					<span
						class="grid size-7 place-items-center rounded-full bg-foreground/85 text-[11px] font-semibold text-background"
						>{initials}</span
					>
					<span class="text-left max-md:hidden">
						<span class="block text-[13px] leading-tight font-medium">{user.displayName}</span>
						<span class="block text-[11px] leading-tight text-muted-foreground"
							>Dev sign-in · switch</span
						>
					</span>
				</DropdownMenu.Trigger>
				<DropdownMenu.Portal>
					<DropdownMenu.Content class={[contentClass, 'w-72']} align="end" sideOffset={6}>
						<div class="px-2.5 pt-1.5 pb-2 text-[12px] text-muted-foreground">
							<span class="block font-medium text-foreground">{user.displayName}</span>
							{user.roles.join(' · ') || 'No roles'}
						</div>
						<DropdownMenu.Separator class="my-1 h-px bg-border" />
						<DropdownMenu.Item class={itemClass} onSelect={() => (location.href = '/signin')}>
							<UserRound class="mt-0.5 size-4 text-muted-foreground" />
							<span class="flex-1">Sign in as someone else</span>
							<FlaskConical class="mt-0.5 size-3.5 text-amber-700" />
						</DropdownMenu.Item>
						<form method="POST" action="/signin?/signout">
							<button class={[itemClass, 'w-full text-left hover:bg-muted']}>
								<LogOut class="mt-0.5 size-4 text-muted-foreground" />
								<span>Sign out</span>
							</button>
						</form>
					</DropdownMenu.Content>
				</DropdownMenu.Portal>
			</DropdownMenu.Root>
		</div>

		{#if tabs}
			<nav class="flex gap-1 px-4" aria-label="Sections">
				{#each tabs as tab (tab.href)}
					<a
						href={tab.href}
						class={[
							'-mb-px flex items-center gap-1.5 border-b-2 px-2.5 pt-1 pb-2.5 text-[13px]',
							tab.active
								? 'border-foreground font-medium text-foreground'
								: 'border-transparent text-muted-foreground hover:text-foreground'
						]}
						aria-current={tab.active ? 'page' : undefined}
					>
						{tab.label}
						{#if tab.count}<span
								class="rounded-full bg-muted px-1.5 text-[11px] font-medium text-muted-foreground"
								>{tab.count}</span
							>{/if}
					</a>
				{/each}
			</nav>
		{/if}
	</header>

	<main class="flex-1">
		{@render children()}
	</main>
</div>
