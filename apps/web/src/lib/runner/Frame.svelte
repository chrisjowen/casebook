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
	// The app shell, the same on every page, the board included: a sidebar with the instance
	// switcher, New and Search (⌘K), My work, Cases and Processes with every process listed under
	// it, and the user; a top bar with breadcrumbs from the section down and the page's actions;
	// and the page's tabs. Guests get none of the switching: only their requests.
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { MediaQuery } from 'svelte/reactivity';
	import { DropdownMenu } from 'bits-ui';
	import {
		Briefcase,
		Check,
		ChevronRight,
		ChevronsUpDown,
		FileSpreadsheet,
		FlaskConical,
		Inbox,
		LogOut,
		Menu,
		Plus,
		Search,
		UserRound,
		Workflow,
		X
	} from '@lucide/svelte';
	import type { Instance } from '@casebook/store';
	import Logo from '$lib/editor/Logo.svelte';
	import CommandPalette from '$lib/shell/CommandPalette.svelte';
	import NewProcessDialog from '$lib/shell/NewProcessDialog.svelte';
	import ImportDialog from '$lib/shell/ImportDialog.svelte';
	import type { ShellData } from '$lib/shell/types';
	import { shellUi } from '$lib/shell/ui.svelte';
	import { links } from './links';

	let {
		user,
		instance,
		instances = [],
		crumbs = [],
		tabs,
		actions,
		fill = false,
		children
	}: {
		user: { displayName: string; roles: string[] };
		/** Unset on a guest's requests pages. */
		instance?: Instance;
		instances?: Instance[];
		/** Below the section crumb (My work, Cases or Processes), which the shell adds. */
		crumbs?: Crumb[];
		tabs?: Tab[];
		/** The page object's actions, at the right of the top bar. */
		actions?: Snippet;
		/** The page fills the window below the shell and scrolls itself, like the board. */
		fill?: boolean;
		children: Snippet;
	} = $props();

	const shell = $derived(page.data.shell as ShellData | undefined);
	const mark = (name: string) =>
		name
			.split(/\s+/)
			.map((w) => w[0])
			.join('')
			.slice(0, 2)
			.toUpperCase();
	const initials = $derived(mark(user.displayName));

	// Which section the page is in, from its address: the editor and process pages are Processes,
	// a case and its tasks are Cases, and the instance home is My work.
	const rest = $derived(
		instance ? page.url.pathname.slice(links.myWork(instance.slug).length) : ''
	);
	const section = $derived(
		rest.startsWith('/processes')
			? 'processes'
			: rest.startsWith('/c/') || rest.startsWith('/cases')
				? 'cases'
				: 'work'
	);
	const nav = $derived(
		instance
			? [
					{
						id: 'work',
						label: 'My work',
						icon: Inbox,
						href: links.myWork(instance.slug),
						count: instance.waitingOnYou
					},
					{ id: 'cases', label: 'Cases', icon: Briefcase, href: links.cases(instance.slug) },
					{
						id: 'processes',
						label: 'Processes',
						icon: Workflow,
						href: links.processes(instance.slug)
					}
				]
			: []
	);
	const sectionCrumb = $derived(nav.find((n) => n.id === section));
	const trail = $derived<Crumb[]>(
		sectionCrumb
			? [{ label: sectionCrumb.label, href: sectionCrumb.href }, ...crumbs]
			: crumbs.length
				? crumbs
				: [{ label: 'Requests for you' }]
	);
	/** The process the page is about, from /processes/<slug> or the editor's ?p=. */
	const openProcess = $derived(
		section !== 'processes'
			? undefined
			: rest.startsWith('/processes/edit')
				? page.url.searchParams.get('p') && page.url.searchParams.get('p') !== 'map'
					? page.url.searchParams.get('p')!
					: undefined
				: rest.split('/')[2]
	);
	const grouped = $derived.by(() => {
		const groups = [...new Set(shell?.processes.map((p) => p.namespace))].map((namespace) => ({
			namespace,
			label: shell?.spaces.find((s) => s.namespace === namespace)?.label ?? namespace,
			processes: shell?.processes.filter((p) => p.namespace === namespace) ?? []
		}));
		return groups.map((g) => ({
			...g,
			label:
				groups.filter((o) => o.label === g.label).length > 1
					? `${g.label} · ${g.namespace}`
					: g.label
		}));
	});
	// Where New process and Import start: the open process's workspace, else the busiest one.
	const preferred = $derived.by(() => {
		const writable = shell?.spaces.filter((s) => s.canCreate.allowed) ?? [];
		const here = shell?.processes.find((p) => p.slug === openProcess)?.namespace;
		const size = (ns: string) => shell?.processes.filter((p) => p.namespace === ns).length ?? 0;
		return (
			writable.find((s) => s.namespace === here) ??
			[...writable].sort((a, b) => size(b.namespace) - size(a.namespace))[0]
		)?.id;
	});
	const canCreate = $derived(shell?.spaces.some((s) => s.canCreate.allowed) ?? false);
	const createReason = $derived(
		shell?.spaces[0]?.canCreate.reason ?? 'You cannot create processes here.'
	);

	let drawer = $state(false);
	let aside = $state<HTMLElement>();
	let opener = $state<HTMLButtonElement>();
	// Below lg the sidebar is a drawer: out of the tab order while closed, holding focus while open.
	const wide = new MediaQuery('min-width: 1024px', true);
	function openDrawer() {
		drawer = true;
		requestAnimationFrame(() => aside?.querySelector<HTMLElement>('a, button')?.focus());
	}
	function closeDrawer() {
		drawer = false;
		// Once the page behind is no longer inert.
		requestAnimationFrame(() => opener?.focus());
	}
	/** Opens a dialog once the menu that asked for it has closed and handed focus back. */
	const later = (open: () => void) => setTimeout(open, 0);
	$effect(() => {
		void page.url.pathname;
		drawer = false;
	});

	const itemClass =
		'flex cursor-pointer items-start gap-3 rounded-lg px-2.5 py-2 text-[13px] outline-none data-highlighted:bg-muted data-disabled:cursor-not-allowed data-disabled:text-muted-foreground/70';
	const contentClass =
		'z-50 min-w-64 max-w-80 rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-lg shadow-black/5';
	const navItem =
		'flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] transition-colors hover:bg-muted';
</script>

<svelte:window
	onkeydown={(e) => {
		if (instance && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
			e.preventDefault();
			shellUi.palette = !shellUi.palette;
		} else if (e.key === 'Escape' && drawer) {
			closeDrawer();
		}
	}}
/>

<div class={['flex bg-canvas text-foreground', fill ? 'h-dvh overflow-hidden' : 'min-h-dvh']}>
	<a
		href="#main"
		class="sr-only z-[70] rounded-lg bg-background px-3 py-2 text-[13px] focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
		>Skip to content</a
	>
	{#if drawer}
		<button
			class="fixed inset-0 z-40 bg-foreground/15 lg:hidden"
			aria-label="Close the menu"
			tabindex="-1"
			onclick={closeDrawer}
		></button>
	{/if}

	<aside
		bind:this={aside}
		inert={!wide.current && !drawer}
		role={!wide.current && drawer ? 'dialog' : undefined}
		aria-modal={!wide.current && drawer ? true : undefined}
		class={[
			'fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col border-r bg-sidebar transition-transform duration-200 lg:sticky lg:top-0 lg:z-auto lg:h-dvh lg:w-60 lg:translate-x-0',
			drawer ? 'translate-x-0 shadow-xl' : '-translate-x-full'
		]}
		aria-label="casebook"
	>
		<div class="flex h-12 shrink-0 items-center gap-1 px-2.5">
			{#if instance}
				<DropdownMenu.Root>
					<DropdownMenu.Trigger
						class="flex h-9 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-lg px-1.5 text-[14px] font-medium hover:bg-muted data-[state=open]:bg-muted"
						aria-label="Casebook: {instance.name}. Switch casebook"
					>
						<span
							class="grid size-6 shrink-0 place-items-center rounded-md bg-brand text-[10px] font-semibold text-white"
							>{mark(instance.name)}</span
						>
						<span class="min-w-0 flex-1 truncate text-left">{instance.name}</span>
						<ChevronsUpDown class="size-3.5 shrink-0 text-muted-foreground" />
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
										onSelect={() => goto(links.myWork(inst.slug))}
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
				<a href={links.requests()} class="flex items-center gap-2 px-1.5" aria-label="casebook home"
					><Logo /><span class="text-[15px] font-semibold tracking-tight">casebook</span></a
				>
			{/if}
			<button
				class="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground hover:bg-muted lg:hidden"
				aria-label="Close the menu"
				onclick={closeDrawer}><X class="size-4" /></button
			>
		</div>

		{#if instance}
			<div class="flex shrink-0 gap-1.5 px-2.5 pt-1 pb-3">
				<DropdownMenu.Root>
					<DropdownMenu.Trigger
						class="flex h-8 flex-1 cursor-pointer items-center gap-1.5 rounded-lg border bg-background px-2.5 text-[13px] font-medium shadow-xs hover:bg-muted data-[state=open]:bg-muted"
					>
						<Plus class="size-4" />New
					</DropdownMenu.Trigger>
					<DropdownMenu.Portal>
						<DropdownMenu.Content class={contentClass} align="start" sideOffset={6}>
							<DropdownMenu.Item
								class={itemClass}
								onSelect={() =>
									goto(
										links.newCase(instance.slug, {
											process: openProcess ?? undefined
										})
									)}
							>
								<Briefcase class="mt-0.5 size-4 text-muted-foreground" />
								<span class="flex-1">
									<span class="block font-medium">New case</span>
									<span class="block text-[12px] text-muted-foreground"
										>Start running a process for someone or something</span
									>
								</span>
							</DropdownMenu.Item>
							<DropdownMenu.Item
								class={itemClass}
								disabled={!canCreate}
								onSelect={() => later(() => (shellUi.newProcess = true))}
							>
								<Workflow class="mt-0.5 size-4 text-muted-foreground" />
								<span class="flex-1">
									<span class="block font-medium">New process</span>
									<span class="block text-[12px] text-muted-foreground"
										>{canCreate ? 'Design one on the board' : createReason}</span
									>
								</span>
							</DropdownMenu.Item>
							<DropdownMenu.Item
								class={itemClass}
								disabled={!canCreate}
								onSelect={() => later(() => (shellUi.importing = true))}
							>
								<FileSpreadsheet class="mt-0.5 size-4 text-muted-foreground" />
								<span class="flex-1">
									<span class="block font-medium">Import a spreadsheet</span>
									<span class="block text-[12px] text-muted-foreground"
										>{canCreate ? 'Let the assistant draft processes from it' : createReason}</span
									>
								</span>
							</DropdownMenu.Item>
						</DropdownMenu.Content>
					</DropdownMenu.Portal>
				</DropdownMenu.Root>
				<button
					class="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border bg-background px-2.5 text-[13px] text-muted-foreground shadow-xs hover:bg-muted hover:text-foreground"
					aria-label="Search and commands"
					title="Search processes, cases and tasks (⌘K)"
					onclick={() => (shellUi.palette = true)}
					><Search class="size-4" /><kbd class="font-sans text-[11px]">⌘K</kbd></button
				>
			</div>
		{/if}

		<nav class="no-scrollbar min-h-0 flex-1 overflow-y-auto px-2.5 pb-3" aria-label="Main">
			{#if instance}
				<ul class="flex flex-col gap-0.5">
					{#each nav as item (item.id)}
						{@const Icon = item.icon}
						{@const current = section === item.id}
						<li>
							<a
								href={item.href}
								aria-current={current ? 'page' : undefined}
								class={[navItem, current ? 'bg-muted font-medium' : 'text-foreground/80']}
							>
								<Icon class={['size-4', current ? 'text-foreground' : 'text-muted-foreground']} />
								<span class="flex-1">{item.label}</span>
								{#if item.count}<span
										class="rounded-full bg-brand-soft px-1.5 text-[11px] font-medium text-brand"
										>{item.count}</span
									>{/if}
							</a>
						</li>
					{/each}
				</ul>

				{#each grouped as group (group.namespace)}
					<div class="mt-5">
						<p
							class="flex items-center px-2.5 pb-1 text-[11.5px] font-medium text-muted-foreground"
						>
							<span class="flex-1 truncate"
								>{grouped.length > 1 ? `Processes · ${group.label}` : 'Processes'}</span
							>
						</p>
						<ul class="flex flex-col gap-0.5">
							{#each group.processes as p (p.id)}
								{@const current = openProcess === p.slug}
								<li>
									<a
										href={links.process(instance.slug, p.slug)}
										aria-current={current ? 'page' : undefined}
										class={[
											navItem,
											'h-7.5 text-[13px]',
											current ? 'bg-muted font-medium' : 'text-foreground/75'
										]}
									>
										<span
											class={[
												'size-1.5 shrink-0 rounded-full',
												p.status === 'draft'
													? 'border border-muted-foreground'
													: p.draftPending
														? 'bg-amber-500'
														: 'bg-emerald-500'
											]}
											aria-hidden="true"
										></span>
										<span class="min-w-0 flex-1 truncate">{p.title}</span>
										{#if p.status === 'draft'}<span class="text-[11px] text-muted-foreground"
												>Draft</span
											>{:else if p.draftPending}<span class="sr-only">Draft changes pending</span
											>{/if}
									</a>
								</li>
							{/each}
						</ul>
					</div>
				{/each}
			{:else}
				<a href={links.requests()} aria-current="page" class={[navItem, 'bg-muted font-medium']}
					><Inbox class="size-4" />Requests for you</a
				>
			{/if}
		</nav>

		<div class="shrink-0 border-t p-2.5">
			<DropdownMenu.Root>
				<DropdownMenu.Trigger
					class="flex w-full cursor-pointer items-center gap-2.5 rounded-lg p-1.5 text-left hover:bg-muted data-[state=open]:bg-muted"
					aria-label="Signed in as {user.displayName}"
				>
					<span
						class="grid size-7 shrink-0 place-items-center rounded-full bg-foreground/85 text-[11px] font-semibold text-background"
						>{initials}</span
					>
					<span class="min-w-0 flex-1">
						<span class="block truncate text-[13px] leading-tight font-medium"
							>{user.displayName}</span
						>
						<span class="block text-[11px] leading-tight text-muted-foreground"
							>Dev sign-in · switch</span
						>
					</span>
					<ChevronsUpDown class="size-3.5 shrink-0 text-muted-foreground" />
				</DropdownMenu.Trigger>
				<DropdownMenu.Portal>
					<DropdownMenu.Content
						class={[contentClass, 'w-72']}
						align="start"
						side="top"
						sideOffset={6}
					>
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
	</aside>

	<div class={['flex min-w-0 flex-1 flex-col', fill && 'min-h-0']} inert={!wide.current && drawer}>
		<header class="sticky top-0 z-30 shrink-0 border-b bg-background">
			<div class="flex h-12 items-center gap-2 px-3 lg:px-6">
				<button
					class="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground hover:bg-muted lg:hidden"
					bind:this={opener}
					aria-label="Open the menu"
					aria-expanded={drawer}
					onclick={openDrawer}><Menu class="size-4" /></button
				>
				<nav aria-label="Breadcrumb" class="min-w-0 flex-1">
					<ol class="flex min-w-0 items-center gap-0.5 text-[13.5px]">
						{#each trail as crumb, i (i)}
							{@const last = i === trail.length - 1}
							<!-- On a phone only the page and its parent show, the parent as the way back. -->
							<li
								class={[
									'flex min-w-0 items-center gap-0.5',
									i < trail.length - 2 && 'max-sm:hidden'
								]}
							>
								{#if i > 0}<ChevronRight
										class={[
											'size-3.5 shrink-0 text-muted-foreground/60',
											i === trail.length - 2 && 'max-sm:hidden'
										]}
										aria-hidden="true"
									/>{/if}
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
				{#if actions}<div class="flex shrink-0 items-center gap-2">{@render actions()}</div>{/if}
			</div>

			{#if tabs}
				<nav class="no-scrollbar flex gap-1 overflow-x-auto px-3 lg:px-6" aria-label="Sections">
					{#each tabs as tab (tab.href)}
						<a
							href={tab.href}
							class={[
								'-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 pt-1 pb-2.5 text-[13px]',
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

		<main id="main" class={fill ? 'flex min-h-0 flex-1 flex-col' : 'flex-1'}>
			{@render children()}
		</main>
	</div>
</div>

{#if instance && shell}
	<CommandPalette
		bind:open={shellUi.palette}
		instance={instance.slug}
		processes={shell.processes}
		createBlocked={canCreate ? undefined : createReason}
		onnewprocess={() => (shellUi.newProcess = true)}
		onimport={() => (shellUi.importing = true)}
	/>
	<NewProcessDialog
		bind:open={shellUi.newProcess}
		instance={instance.slug}
		spaces={shell.spaces}
		{preferred}
	/>
	<ImportDialog
		bind:open={shellUi.importing}
		instance={instance.slug}
		spaces={shell.spaces}
		imports={shell.imports}
		{preferred}
	/>
{/if}
