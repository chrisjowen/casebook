<script module lang="ts">
	export type RailItem = 'graph' | 'map' | 'facts' | 'roles';
</script>

<script lang="ts">
	import { Workflow, Network, Database, Users, PanelLeft } from '@lucide/svelte';
	let {
		active,
		onpick,
		outline = $bindable(true)
	}: { active: RailItem; onpick: (item: RailItem) => void; outline?: boolean } = $props();
	const items = [
		{ id: 'graph' as const, icon: Workflow, label: 'Process graph' },
		{ id: 'map' as const, icon: Network, label: 'Process map' },
		{ id: 'facts' as const, icon: Database, label: 'Shared fact types' },
		{ id: 'roles' as const, icon: Users, label: 'Process details and roles' }
	];
</script>

<nav
	class="flex w-14 shrink-0 flex-col items-center gap-1 border-r bg-background py-3"
	aria-label="Editor"
>
	<button
		class={[
			'mb-2 flex size-9 cursor-pointer items-center justify-center rounded-xl hover:bg-muted',
			outline ? 'text-foreground' : 'text-muted-foreground'
		]}
		title="Toggle outline"
		aria-label="Toggle outline"
		aria-pressed={outline}
		onclick={() => (outline = !outline)}><PanelLeft class="size-[18px]" /></button
	>
	{#each items as item (item.id)}
		<button
			class={[
				'flex size-9 cursor-pointer items-center justify-center rounded-xl transition-colors',
				active === item.id
					? 'bg-brand-soft text-brand shadow-[inset_0_0_0_1px_var(--brand-ring)]'
					: 'text-muted-foreground hover:bg-muted hover:text-foreground'
			]}
			title={item.label}
			aria-label={item.label}
			aria-current={active === item.id ? 'page' : undefined}
			onclick={() => onpick(item.id)}><item.icon class="size-[18px]" /></button
		>
	{/each}
</nav>
