<script lang="ts">
	// An object's "…" menu: its verbs from actions.ts, the same on its page, its rows and the
	// palette. Unavailable verbs stay visible, disabled, with the reason underneath.
	import { goto } from '$app/navigation';
	import { DropdownMenu } from 'bits-ui';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import type { Verb } from './actions';

	let {
		verbs,
		label,
		omit = [],
		size = 'md'
	}: {
		verbs: Verb[];
		/** What the menu is for, such as the process title, for its accessible name. */
		label: string;
		/** Verbs to leave out, such as the page the menu is on. */
		omit?: string[];
		size?: 'sm' | 'md';
	} = $props();

	const shown = $derived(verbs.filter((v) => !omit.includes(v.id)));
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger
		class={[
			'flex shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground',
			size === 'sm' ? 'size-8' : 'size-9 border bg-background'
		]}
		aria-label="Actions for {label}"
		onclick={(e: MouseEvent) => e.stopPropagation()}
	>
		<Ellipsis class="size-4" />
	</DropdownMenu.Trigger>
	<DropdownMenu.Portal>
		<DropdownMenu.Content
			class="z-50 min-w-56 rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-lg shadow-black/5"
			align="end"
			sideOffset={6}
		>
			{#each shown as verb (verb.id)}
				{@const Icon = verb.icon}
				{#if verb.id === 'copy'}<DropdownMenu.Separator class="my-1 h-px bg-border" />{/if}
				<DropdownMenu.Item
					class="flex cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-2 text-[13px] outline-none data-highlighted:bg-muted data-disabled:cursor-not-allowed data-disabled:text-muted-foreground/70"
					disabled={!!verb.disabled}
					onSelect={() => {
						if (verb.run) verb.run();
						else if (verb.href) void goto(verb.href);
					}}
				>
					<Icon class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
					<span class="min-w-0 flex-1">
						<span class="block">{verb.label}</span>
						{#if verb.disabled}<span class="block text-[12px] text-muted-foreground"
								>{verb.disabled}</span
							>{/if}
					</span>
				</DropdownMenu.Item>
			{/each}
		</DropdownMenu.Content>
	</DropdownMenu.Portal>
</DropdownMenu.Root>
