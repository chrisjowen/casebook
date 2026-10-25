<script lang="ts">
	// ⌘K, on every page: jump to any process, case or task, or run an action. With nothing typed it
	// offers what to create, where to go, your tasks, the processes and the cases; typing searches
	// all of them, and each process, case and task also offers its verbs from actions.ts.
	import type { Component } from 'svelte';
	import { goto } from '$app/navigation';
	import type { ResolvedPathname } from '$app/types';
	import {
		Briefcase,
		FileSpreadsheet,
		Inbox,
		LoaderCircle,
		Plus,
		Search,
		SquareCheck,
		Workflow
	} from '@lucide/svelte';
	import { links } from '$lib/runner/links';
	import { caseVerbs, processVerbs, taskVerbs, type Verb } from './actions';
	import type { SearchData, ShellProcess } from './types';

	let {
		open = $bindable(false),
		instance,
		processes,
		createBlocked,
		startBlocked,
		onnewprocess,
		onimport
	}: {
		open?: boolean;
		instance: string;
		processes: ShellProcess[];
		/** Why the user cannot create processes here, when they cannot. */
		createBlocked?: string;
		/** Why the user cannot start a case here, when they cannot. */
		startBlocked?: string;
		onnewprocess: () => void;
		onimport: () => void;
	} = $props();

	interface Command {
		key: string;
		group: string;
		label: string;
		hint?: string;
		icon: Component;
		href?: ResolvedPathname;
		run?: () => void;
		disabled?: string;
		/** Shown before anything is typed. */
		top?: boolean;
	}

	let query = $state('');
	let active = $state(0);
	let found = $state<SearchData | undefined>();
	let loading = $state(false);
	let failed = $state(false);
	let list = $state<HTMLDivElement>();

	// Focus goes back where it was when the palette closes.
	let returnTo: HTMLElement | null = null;
	$effect(() => {
		if (!open) return;
		returnTo = document.activeElement as HTMLElement | null;
		query = '';
		loading = true;
		failed = false;
		fetch(links.search(instance))
			.then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.statusText))))
			.then((d: SearchData) => (found = d))
			.catch(() => (failed = true))
			.finally(() => (loading = false));
		return () => {
			const target = returnTo;
			// Unless what it ran took focus, such as the New process dialog.
			requestAnimationFrame(() => {
				if (document.activeElement === document.body && target?.isConnected) target.focus();
			});
		};
	});

	/** An object's verbs as commands; its first verb (open) is the object itself. */
	function verbCommands(
		group: string,
		key: string,
		title: string,
		hint: string,
		icon: Component,
		verbs: Verb[],
		top: boolean
	): Command[] {
		return verbs
			.filter((v) => v.id !== 'copy')
			.map((v, i) =>
				i === 0
					? { key: `${key}:${v.id}`, group, label: title, hint, icon, href: v.href, top }
					: {
							key: `${key}:${v.id}`,
							group,
							label: `${v.label}: ${title}`,
							icon: v.icon,
							href: v.href,
							...(v.disabled ? { disabled: v.disabled } : {})
						}
			);
	}

	const commands = $derived.by((): Command[] => {
		const all: Command[] = [
			{
				key: 'new-case',
				group: 'Create',
				label: 'New case',
				icon: Plus,
				href: links.newCase(instance),
				...(startBlocked ? { disabled: startBlocked } : {}),
				top: true
			},
			{
				key: 'new-process',
				group: 'Create',
				label: 'New process',
				icon: Workflow,
				run: onnewprocess,
				...(createBlocked ? { disabled: createBlocked } : {}),
				top: true
			},
			{
				key: 'import',
				group: 'Create',
				label: 'Import a spreadsheet',
				icon: FileSpreadsheet,
				run: onimport,
				...(createBlocked ? { disabled: createBlocked } : {}),
				top: true
			},
			{
				key: 'go-work',
				group: 'Go to',
				label: 'My work',
				icon: Inbox,
				href: links.myWork(instance),
				top: true
			},
			{
				key: 'go-cases',
				group: 'Go to',
				label: 'Cases',
				icon: Briefcase,
				href: links.cases(instance),
				top: true
			},
			{
				key: 'go-processes',
				group: 'Go to',
				label: 'Processes',
				icon: Workflow,
				href: links.processes(instance),
				top: true
			}
		];
		(found?.tasks ?? []).forEach((t, i) =>
			all.push(
				...verbCommands(
					'Your tasks',
					`task:${t.attachmentId}:${t.item}`,
					t.title,
					`${t.caseTitle} · ${t.process}`,
					SquareCheck,
					taskVerbs(instance, t),
					i < 5
				)
			)
		);
		for (const p of processes) {
			all.push(
				...verbCommands(
					'Processes',
					`process:${p.id}`,
					p.title,
					p.status === 'draft' ? 'Draft' : 'Process',
					Workflow,
					processVerbs(instance, p),
					true
				)
			);
		}
		(found?.cases ?? []).forEach((c, i) =>
			all.push(
				...verbCommands(
					'Cases',
					`case:${c.id}`,
					c.title,
					c.subject ?? 'Case',
					Briefcase,
					caseVerbs(instance, c),
					i < 6
				)
			)
		);
		return all;
	});

	const shown = $derived.by(() => {
		const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
		if (!words.length) return commands.filter((c) => c.top);
		return commands
			.filter((c) => {
				const text = `${c.group} ${c.label} ${c.hint ?? ''}`.toLowerCase();
				return words.every((w) => text.includes(w));
			})
			.slice(0, 40);
	});

	/** The next option that can run, stepping by `by` from `from`. */
	function step(from: number, by: number) {
		const n = shown.length;
		for (let k = 1; k <= n; k++) {
			const i = (((from + by * k) % n) + n) % n;
			if (!shown[i]?.disabled) return i;
		}
		return from;
	}
	$effect(() => {
		void query;
		active = shown[0]?.disabled ? step(0, 1) : 0;
	});
	$effect(() => {
		list?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
	});

	function run(c: Command) {
		if (c.disabled) return;
		open = false;
		if (c.run) c.run();
		else if (c.href) void goto(c.href);
	}

	function key(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			open = false;
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			active = step(active, 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			active = step(active, -1);
		} else if (e.key === 'Enter' && shown[active]) {
			e.preventDefault();
			run(shown[active]);
		}
		e.stopPropagation();
	}
	const focus = (node: HTMLInputElement) => node.focus();
</script>

{#if open}
	<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
	<div
		class="fixed inset-0 z-[60] flex justify-center bg-foreground/15 px-4 pt-[12vh]"
		onclick={() => (open = false)}
	>
		<div
			class="flex h-fit max-h-[70vh] w-full max-w-[600px] flex-col overflow-hidden rounded-2xl border bg-popover shadow-xl"
			role="dialog"
			aria-modal="true"
			aria-label="Search and run a command"
			tabindex="-1"
			onclick={(e) => e.stopPropagation()}
		>
			<label class="flex shrink-0 items-center gap-2.5 border-b px-4">
				<Search class="size-4 shrink-0 text-muted-foreground" />
				<input
					class="h-13 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
					placeholder="Search processes, cases and tasks, or type a command"
					aria-label="Search"
					role="combobox"
					aria-expanded="true"
					aria-controls="palette-results"
					aria-activedescendant={shown[active] ? `palette-${active}` : undefined}
					bind:value={query}
					use:focus
					onkeydown={key}
				/>
				{#if loading}<LoaderCircle class="size-4 animate-spin text-muted-foreground" />{/if}
				<kbd class="rounded-md border px-1.5 text-[11px] text-muted-foreground">Esc</kbd>
			</label>
			<div
				bind:this={list}
				id="palette-results"
				role="listbox"
				aria-label="Results"
				class="min-h-0 flex-1 overflow-y-auto p-1.5"
			>
				{#each shown as c, i (c.key)}
					{@const Icon = c.icon}
					{#if shown[i - 1]?.group !== c.group}
						<div class="px-2.5 pt-2.5 pb-1 text-[11.5px] font-medium text-muted-foreground">
							{c.group}
						</div>
					{/if}
					<div
						id="palette-{i}"
						data-index={i}
						role="option"
						tabindex="-1"
						aria-selected={active === i}
						aria-disabled={c.disabled ? true : undefined}
						class={[
							'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px]',
							c.disabled ? 'cursor-not-allowed text-muted-foreground/70' : 'cursor-pointer',
							active === i && 'bg-muted'
						]}
						onpointermove={() => !c.disabled && (active = i)}
						onclick={() => run(c)}
						onkeydown={() => {}}
					>
						<Icon class="size-4 shrink-0 text-muted-foreground" />
						<span class="min-w-0 flex-1">
							<span class="block truncate">{c.label}</span>
							{#if c.disabled}<span class="block text-[12px] text-muted-foreground"
									>{c.disabled}</span
								>{/if}
						</span>
						{#if c.hint && !c.disabled}<span
								class="max-w-[45%] shrink-0 truncate text-[12px] text-muted-foreground"
								>{c.hint}</span
							>{/if}
					</div>
				{:else}
					<p class="px-3 py-8 text-center text-[13px] text-muted-foreground">
						{loading ? 'Looking…' : `Nothing matches “${query.trim()}”.`}
					</p>
				{/each}
				{#if failed}
					<p class="px-3 py-2 text-[12px] text-muted-foreground">
						Cases and tasks could not be loaded; processes and actions still work.
					</p>
				{/if}
			</div>
			<div
				class="flex shrink-0 items-center gap-4 border-t px-4 py-2 text-[11.5px] text-muted-foreground"
			>
				<span><kbd class="font-sans">↑↓</kbd> to move</span>
				<span><kbd class="font-sans">↵</kbd> to open</span>
				<span class="ml-auto">Try “start”, “edit” or a case name</span>
			</div>
		</div>
	</div>
{/if}
