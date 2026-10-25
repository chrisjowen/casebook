<script lang="ts">
	import Frame from '$lib/runner/Frame.svelte';
	import TaskForm from '$lib/runner/TaskForm.svelte';
	import { links } from '$lib/runner/links';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head><title>{data.task.task.title}</title></svelte:head>

<Frame user={data.user} crumbs={[{ label: data.task.task.title }]}>
	<div class="mx-auto max-w-2xl px-4 py-8">
		<a
			href={links.requests()}
			class="mb-4 inline-block text-[13px] text-muted-foreground hover:text-foreground"
			>← Requests for you</a
		>
		<TaskForm view={data.task} me={data.user.id} {form} demoFiles={data.demoFiles} />
	</div>
</Frame>
