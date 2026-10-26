<script lang="ts">
	// A work item's status in words, with an icon: never colour alone.
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import CircleDot from '@lucide/svelte/icons/circle-dot';
	import CircleSlash from '@lucide/svelte/icons/circle-slash';
	import Hourglass from '@lucide/svelte/icons/hourglass';
	import Lock from '@lucide/svelte/icons/lock';
	import Repeat from '@lucide/svelte/icons/repeat';
	import type { TaskSummary } from '@casebook/store';
	import { names, relative } from './format';

	let {
		task,
		me
	}: {
		task: Pick<TaskSummary, 'status' | 'repeating' | 'due' | 'overdue' | 'waitingOn'>;
		/** The signed-in user: work waiting on their own earlier task says so. */
		me?: string;
	} = $props();

	const waitingLabel = $derived(
		task.waitingOn && me && task.waitingOn.holders.some((h) => h.id === me)
			? `After “${task.waitingOn.title}”`
			: `Waiting on ${names(task.waitingOn?.holders ?? [])}`
	);
</script>

{#if task.repeating && (task.status === 'ready' || task.status === 'held') && task.due}
	<!-- Recurring work stays quiet: a due time, never an alarm. -->
	<span class="tag bg-muted text-muted-foreground"
		><Repeat class="size-3" />Recurring · next {task.overdue ? 'was due' : 'due'}
		{relative(task.due)}</span
	>
{:else if task.status === 'ready'}
	<span class="tag bg-brand-soft text-brand"><CircleDot class="size-3" />Ready</span>
{:else if task.status === 'held'}
	<span class="tag bg-amber-50 text-amber-800"><CircleAlert class="size-3" />Needs information</span
	>
{:else if task.status === 'blocked'}
	<span class="tag bg-amber-50 text-amber-800"
		><CircleAlert class="size-3" />Missing information</span
	>
{:else if task.status === 'waiting'}
	<span class="tag bg-muted text-muted-foreground"><Hourglass class="size-3" />{waitingLabel}</span>
{:else if task.status === 'upcoming'}
	<span class="tag bg-muted text-muted-foreground"><Lock class="size-3" />Later</span>
{:else if task.status === 'skipped'}
	<span class="tag text-muted-foreground"><CircleSlash class="size-3" />Not needed</span>
{:else if task.status === 'done'}
	<span class="tag text-muted-foreground"><CircleCheck class="size-3" />Done</span>
{/if}

<style>
	.tag {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		white-space: nowrap;
		border-radius: 9999px;
		padding: 0.125rem 0.5rem;
		font-size: 12px;
		font-weight: 500;
	}
</style>
