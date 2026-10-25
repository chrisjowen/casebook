<script lang="ts">
	// The whole process on one case, read-only: every stage and step, with this case's progress.
	import Frame from '$lib/runner/Frame.svelte';
	import ProcessOutline from '$lib/runner/ProcessOutline.svelte';
	import { links } from '$lib/runner/links';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const c = $derived(data.case);
	const slug = $derived(data.instance.slug);
	const process = $derived(data.process);
</script>

<svelte:head><title>{process.name} · {c.title}</title></svelte:head>

<Frame
	user={data.user}
	instance={data.instance}
	instances={data.instances}
	crumbs={[{ label: c.title, href: links.case(slug, c.id) }, { label: process.name }]}
>
	<div class="max-w-6xl px-4 py-8 lg:px-6">
		<header class="px-1">
			<h1 class="text-[22px] font-semibold tracking-tight">{process.name}</h1>
			<p class="mt-1 text-[14px] text-muted-foreground">
				The whole process, read-only, with where {c.title} is in it.
				{process.binding === 'pinned'
					? `This case runs version ${process.version}.`
					: 'This case follows the latest version.'}
				<a
					href={links.process(slug, process.definitionSlug)}
					class="text-foreground/80 underline-offset-2 hover:underline">Open in Processes →</a
				>
			</p>
		</header>
		<ProcessOutline document={process.document} stages={process.stages} items={process.items} />
	</div>
</Frame>
