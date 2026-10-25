<script lang="ts">
	// The board inside its own Svelte Flow context, so it can place things where they are dropped.
	import type { ComponentProps } from 'svelte';
	import { SvelteFlowProvider } from '@xyflow/svelte';
	import BoardCanvas from './BoardCanvas.svelte';

	let props: ComponentProps<typeof BoardCanvas> = $props();
</script>

<SvelteFlowProvider><BoardCanvas {...props} /></SvelteFlowProvider>
