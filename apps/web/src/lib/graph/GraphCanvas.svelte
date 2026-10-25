<script lang="ts">
	// Read-only Svelte Flow canvas. Layout runs once per `layoutKey`; selection and search only
	// restyle nodes and edges, so the graph never jumps while someone is reading it.
	import { SvelteFlow, Background, Controls, Panel, type Node, type Edge } from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import { untrack, type Snippet } from 'svelte';
	import CardNode from './nodes/CardNode.svelte';
	import CompactNode from './nodes/CompactNode.svelte';
	import StageNode from './nodes/StageNode.svelte';
	import LaneNode from './nodes/LaneNode.svelte';
	import FactNode from './nodes/FactNode.svelte';
	import ProcessNode from './nodes/ProcessNode.svelte';
	import SharedNode from './nodes/SharedNode.svelte';
	import HandOffEdge from './edges/HandOffEdge.svelte';
	import FlowEdge from './edges/FlowEdge.svelte';
	import FocusNode from './FocusNode.svelte';
	import InitialViewport from './InitialViewport.svelte';
	import { setGraphActions, type GraphActions } from './context';
	import type { Built } from './layout';

	let {
		layoutKey,
		load,
		onselect,
		actions,
		selectedId,
		query = '',
		focusId,
		readableZoom,
		legend
	}: {
		layoutKey: string;
		load: () => Promise<Built>;
		onselect: (type: string, id: string) => void;
		actions: GraphActions;
		selectedId?: string;
		query?: string;
		focusId?: string;
		/** Open at least at this zoom, left-aligned, instead of shrinking wide graphs to fit. */
		readableZoom?: number;
		legend?: Snippet;
	} = $props();

	setGraphActions({ inspect: (id) => actions.inspect(id), copyId: (id) => actions.copyId(id) });

	const nodeTypes = {
		card: CardNode,
		compact: CompactNode,
		stage: StageNode,
		lane: LaneNode,
		fact: FactNode,
		process: ProcessNode,
		shared: SharedNode
	};
	const edgeTypes = { handoff: HandOffEdge, flow: FlowEdge };

	let base: Built = { nodes: [], edges: [] };
	let nodes = $state.raw<Node[]>([]);
	let edges = $state.raw<Edge[]>([]);
	let version = $state(0);
	let width = $state(0);
	let height = $state(0);

	const nameOf = (n: Node) => String((n.data as { title?: string }).title ?? '');
	const matches = (n: Node, q: string) =>
		n.type !== 'stage' && n.type !== 'lane' && nameOf(n).toLowerCase().includes(q);

	function restyle(b: Built, q: string, selected: string | undefined) {
		const needle = q.trim().toLowerCase();
		nodes = b.nodes.map((n) => ({
			...n,
			selected: n.id === selected,
			data: {
				...n.data,
				dim: !!needle && n.type !== 'stage' && n.type !== 'lane' && !matches(n, needle)
			}
		}));
		edges = b.edges.map((e) => ({
			...e,
			data: {
				...e.data,
				active: !!selected && (e.source === selected || e.target === selected),
				dim: !!needle || (!!selected && e.source !== selected && e.target !== selected)
			}
		}));
	}

	$effect(() => {
		void layoutKey;
		let cancelled = false;
		untrack(load).then((built) => {
			if (cancelled) return;
			base = built;
			restyle(
				built,
				untrack(() => query),
				untrack(() => selectedId)
			);
			version++;
		});
		return () => (cancelled = true);
	});

	$effect(() =>
		restyle(
			untrack(() => base),
			query,
			selectedId
		)
	);

	/** Search pans to the first matching card. */
	const searchFocus = $derived.by(() => {
		const needle = query.trim().toLowerCase();
		void version;
		return needle ? base.nodes.find((n) => matches(n, needle))?.id : undefined;
	});
</script>

<div class="h-full w-full bg-canvas" bind:clientWidth={width} bind:clientHeight={height}>
	{#key version}
		<SvelteFlow
			bind:nodes
			bind:edges
			{nodeTypes}
			{edgeTypes}
			fitView={!readableZoom}
			fitViewOptions={{ padding: 0.12, maxZoom: 1.05 }}
			minZoom={0.2}
			maxZoom={1.6}
			nodesDraggable={false}
			nodesConnectable={false}
			zoomOnDoubleClick={false}
			onnodeclick={({ node }) =>
				node.type !== 'stage' && node.type !== 'lane' && onselect(node.type ?? '', node.id)}
			onpaneclick={() => onselect('pane', '')}
		>
			<Background gap={18} size={1.4} bgColor="var(--canvas)" patternColor="var(--canvas-dot)" />
			<Controls showLock={false} position="bottom-right" />
			{#if legend}<Panel position="bottom-left">{@render legend()}</Panel>{/if}
			<FocusNode id={searchFocus ?? focusId} />
			{#if readableZoom}<InitialViewport
					minZoom={readableZoom}
					{width}
					{height}
					focus={focusId ?? selectedId}
				/>{/if}
		</SvelteFlow>
	{/key}
</div>

<style>
	:global(.svelte-flow__controls) {
		box-shadow: 0 1px 2px rgb(0 0 0 / 0.05);
		border: 1px solid var(--color-border);
		border-radius: 10px;
		overflow: hidden;
	}
	:global(.svelte-flow__controls-button) {
		border-bottom-color: var(--color-border);
		width: 28px;
		height: 28px;
	}
	:global(.svelte-flow__attribution) {
		background: transparent;
		opacity: 0.6;
	}
</style>
