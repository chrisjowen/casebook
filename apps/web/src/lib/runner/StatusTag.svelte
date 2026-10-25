<script lang="ts">
	// A work item's status in words, with an icon: never colour alone.
	import {
		CircleAlert,
		CircleCheck,
		CircleDot,
		CircleSlash,
		Hourglass,
		Lock,
		Repeat
	} from '@lucide/svelte';
	import type { TaskSummary } from '@casebook/store';
	import { names, relative } from './format';

	let {
		task
	}: { task: Pick<TaskSummary, 'status' | 'repeating' | 'due' | 'overdue' | 'waitingOn'> } =
		$props();
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
	<span class="tag bg-muted text-muted-foreground"
		><Hourglass class="size-3" />Waiting on {names(task.waitingOn?.holders ?? [])}</span
	>
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
