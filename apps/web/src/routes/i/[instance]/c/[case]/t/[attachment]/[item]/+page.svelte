<script lang="ts">
	// One task on a case: where its process stands (stages only), then the focused form.
	import { Workflow } from '@lucide/svelte';
	import Frame from '$lib/runner/Frame.svelte';
	import StageStrip from '$lib/runner/StageStrip.svelte';
	import TaskForm from '$lib/runner/TaskForm.svelte';
	import { links } from '$lib/runner/links';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const view = $derived(data.task);
	const slug = $derived(data.instance.slug);
	const c = $derived(data.case);
	const process = $derived(view.process!);
</script>

<svelte:head><title>{view.task.title} · {c.title}</title></svelte:head>

<Frame
	user={data.user}
	instance={data.instance}
	instances={data.instances}
	crumbs={[
		{ label: c.title, href: links.case(slug, c.id) },
		{
			label: view.task.stage.title,
			hint: process.name,
			href: links.here(new URL(links.case(slug, c.id), 'http://x'), {
				process: process.definitionSlug
			})
		},
		{ label: view.task.title }
	]}
>
	<div class="mx-auto max-w-2xl px-4 py-8">
		<div class="mb-6 rounded-xl border bg-card px-5 py-4">
			<div class="mb-3 flex items-center gap-2 text-[12px] text-muted-foreground">
				<span>Stage {view.task.stage.number} of {view.task.stage.count}</span>
				<a
					href={links.wholeProcess(slug, c.id, process.id)}
					class="ml-auto flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-muted hover:text-foreground"
					><Workflow class="size-3.5" />View whole process</a
				>
			</div>
			<StageStrip stages={process.stages} />
		</div>

		<TaskForm
			{view}
			me={data.user.id}
			{form}
			demoFiles={data.demoFiles}
			taskHref={(attachment, item) => links.task(slug, c.id, attachment, item)}
		/>
	</div>
</Frame>
