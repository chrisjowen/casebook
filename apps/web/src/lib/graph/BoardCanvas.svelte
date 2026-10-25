<script lang="ts">
	// The board: a process's stages as columns, built and linked in place. Right-click, the "+"
	// buttons, dragging a dot, double-clicking a name or the palette add and link things; every
	// gesture is one edit of the draft through the page's Editor, so permissions, stale drafts,
	// undo and publishing work as for any edit. Someone who cannot edit sees the same board,
	// without the controls.
	import { tick, type Snippet } from 'svelte';
	import {
		SvelteFlow,
		Background,
		Controls,
		Panel,
		useSvelteFlow,
		type Edge,
		type Node,
		type OnConnectEnd
	} from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import type { FactId, StageId } from '@casebook/model';
	import {
		ArrowLeftToLine,
		ArrowRightLeft,
		ArrowRightToLine,
		Columns3,
		Copy,
		Info,
		Link2,
		ListPlus,
		Maximize,
		PencilLine,
		Plus,
		Search,
		Signpost,
		Split,
		SquarePen,
		SquareStack,
		Trash2,
		Unlink,
		X
	} from '@lucide/svelte';
	import { getEditor } from '$lib/editor/editing.svelte';
	import * as ops from '$lib/editor/ops';
	import Menu from '$lib/editor/Menu.svelte';
	import QuickAdd from '$lib/editor/QuickAdd.svelte';
	import LinkBox from '$lib/editor/LinkBox.svelte';
	import Palette from '$lib/editor/Palette.svelte';
	import { buildBoard, columnAt, GHOST_ID, type BoardCardData, type BoardEdgeData } from './board';
	import {
		BoardUI,
		setBoard,
		type AddContext,
		type Command,
		type MenuItem
	} from './board-context.svelte';
	import { collectsOf, labelOf, type HandOff, type ProcessIndex, type WorkItem } from './derive';
	import BoardCard from './nodes/BoardCard.svelte';
	import BoardStage from './nodes/BoardStage.svelte';
	import AddStage from './nodes/AddStage.svelte';
	import BoardEdge from './edges/BoardEdge.svelte';

	let {
		ix,
		editable,
		selectedId,
		onselect,
		query = '',
		legend
	}: {
		ix: ProcessIndex;
		/** False for someone who cannot edit this draft. */
		editable: boolean;
		selectedId?: string;
		onselect: (id: string | undefined) => void;
		query?: string;
		legend?: Snippet;
	} = $props();

	const editor = getEditor();
	const ui = new BoardUI();
	const flow = useSvelteFlow();
	const nodeTypes = { card: BoardCard, stage: BoardStage, addStage: AddStage };
	const edgeTypes = { board: BoardEdge };

	const built = $derived(buildBoard(ix));
	/** The laid-out cards, with the selection marked and cards that do not match a search dimmed. */
	function styledNodes(): Node[] {
		const needle = query.trim().toLowerCase();
		const hit = (n: Node) => {
			const d = n.data as BoardCardData;
			return [d.title, ...d.rows.map((r) => r.title)].some((t) => t.toLowerCase().includes(needle));
		};
		return built.nodes.map((n) => ({
			...n,
			selected: n.id === selectedId,
			...(n.type === 'card' ? { data: { ...n.data, dim: !!needle && !hit(n) } } : {})
		}));
	}
	/** The links, plus every link of the selected card, even those a longer path makes redundant. */
	function styledEdges(): Edge[] {
		const shown = new Set(built.edges.map((e) => e.id));
		const own = built.all.filter(
			(e) => !shown.has(e.id) && (e.source === selectedId || e.target === selectedId)
		);
		return [...built.edges, ...own];
	}
	// seeded here as well as in the effect, so the board is in the server-rendered page
	let nodes = $state.raw<Node[]>(styledNodes());
	let edges = $state.raw<Edge[]>(styledEdges());
	$effect(() => {
		ui.selected = selectedId;
	});
	$effect(() => {
		nodes = styledNodes();
		edges = styledEdges();
	});

	// ---- editing ------------------------------------------------------------------------------
	let wrap = $state<HTMLElement>();
	let pointer = { x: 0, y: 0 };
	const kindOf = (id: string | undefined) => (id ? ix.byId.get(id)?.core.kind : undefined);
	const isWork = (id: string | undefined) => kindOf(id) === 'step' || kindOf(id) === 'decision';

	/** Saves an edit, or shows why it cannot be done. Resolves true once it is saved. */
	async function run(edit: ops.Edit | string | undefined): Promise<boolean> {
		if (!editor || edit === undefined) return false;
		if (typeof edit === 'string') {
			editor.refuse(edit);
			return false;
		}
		if (edit.ops.length === 0) return false;
		const ok = await editor.apply(edit.ops, edit.label);
		if (ok && edit.select) {
			onselect(edit.select);
			reveal(edit.select);
		}
		return ok;
	}

	async function reveal(id: string) {
		await tick();
		await new Promise((resolve) => requestAnimationFrame(resolve));
		const n = nodes.find((x) => x.id === id);
		if (!n || !wrap) return;
		const { x, y, zoom } = flow.getViewport();
		const left = n.position.x * zoom + x;
		const top = n.position.y * zoom + y;
		const w = (n.width ?? 200) * zoom;
		const h = (n.height ?? 100) * zoom;
		if (left < 0 || top < 0 || left + w > wrap.clientWidth - 24 || top + h > wrap.clientHeight - 90)
			flow.setCenter(n.position.x + (n.width ?? 0) / 2, n.position.y + (n.height ?? 0) / 2, {
				zoom,
				duration: 280
			});
	}
	$effect(() => {
		const id = selectedId;
		if (id && isWork(id)) reveal(id);
	});

	interface Created {
		kind: 'step' | 'decision';
		title: string;
		stage: string;
		after?: string;
		fact?: string;
		branch?: { decision: string; choice: string };
		insert?: HandOff;
		needs?: FactId[];
	}

	/** Adds a named step or decision, linked to what it came from, and selects it. */
	async function create(c: Created) {
		if (c.insert) return run(ops.insertBetween(ix.document, c.insert, c.title));
		const from = c.after ? (ix.byId.get(c.after) as WorkItem) : undefined;
		const decision = c.branch ? (ix.byId.get(c.branch.decision) as WorkItem) : undefined;
		const outcome = decision?.core.kind === 'decision' ? decision.core.outcome : undefined;
		const requires = c.fact
			? [c.fact as FactId]
			: outcome
				? [outcome]
				: from
					? (c.needs ?? collectsOf(from).map((x) => x.fact))
					: undefined;
		const added = ops.addWork(ix.document, {
			kind: c.kind,
			title: c.title,
			stage: c.stage as StageId,
			role: (from ?? decision)?.core.role,
			requires,
			when: outcome && c.branch ? ops.branchGuard(ix, outcome, c.branch.choice) : undefined
		});
		const named = c.title.trim() || (c.kind === 'decision' ? 'New decision' : 'New step');
		const ok = await run(
			c.branch
				? {
						...added,
						label: `Added ${named}, which runs only when ${labelOf(ix, c.branch.decision)} is ${c.branch.choice}`
					}
				: added
		);
		// nothing to hand over yet: ask for it straight away
		if (ok && from?.core.kind === 'step' && !collectsOf(from).length) {
			ui.picker = { x: pointer.x, y: pointer.y, from: from.core.id, to: added.id, create: true };
		}
	}

	/** Links an existing item to another, by what the drag started from. */
	async function link(from: string, handle: string, to: string, x: number, y: number) {
		if (from === to || !isWork(to)) return;
		const target = ix.byId.get(to) as WorkItem;
		if (handle.startsWith('f:')) {
			const fact = handle.slice(2) as FactId;
			if (target.core.requires?.includes(fact))
				return editor?.refuse(`${labelOf(ix, to)} already needs ${labelOf(ix, fact)}`);
			if (await run(ops.setNeeds(ix, to, fact, true))) onselect(to);
			return;
		}
		if (handle.startsWith('b:')) return run(ops.branchTo(ix, from, handle.slice(2), to));
		await run(ops.linkWork(ix, from, to));
		ui.picker = { x, y, from, to, create: !collectsOf(ix.byId.get(from) as WorkItem).length };
	}

	// ---- connections --------------------------------------------------------------------------
	const clientOf = (e: MouseEvent | TouchEvent) =>
		'changedTouches' in e
			? { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY }
			: { x: e.clientX, y: e.clientY };

	const onconnectend: OnConnectEnd = (event, state) => {
		ui.connecting = false;
		const from = state.fromNode?.id;
		const handle = state.fromHandle?.id ?? 'out';
		if (!from || !editable) return;
		const p = clientOf(event);
		pointer = p;
		let to = state.toNode?.id;
		if (!to || !isWork(to)) {
			const el = document.elementFromPoint(p.x, p.y)?.closest('.svelte-flow__node');
			to = el?.getAttribute('data-id') ?? undefined;
		}
		if (to === from) return;
		if (to && isWork(to)) return void link(from, handle, to, p.x + 10, p.y + 10);
		const col = columnAt(built.columns, flow.screenToFlowPosition(p));
		ui.add = {
			x: p.x + 10,
			y: p.y - 10,
			stage: col?.id ?? (ix.byId.get(from) as WorkItem).core.stage,
			after: handle === 'out' ? from : undefined,
			fact: handle.startsWith('f:') ? handle.slice(2) : undefined,
			branch: handle.startsWith('b:') ? { decision: from, choice: handle.slice(2) } : undefined
		};
	};

	// ---- dragging a card onto another stage ---------------------------------------------------
	function onnodedrag({
		targetNode,
		event
	}: {
		targetNode: Node | null;
		event: MouseEvent | TouchEvent;
	}) {
		if (targetNode?.type !== 'card') return;
		const col = columnAt(built.columns, flow.screenToFlowPosition(clientOf(event)));
		ui.dropStage = col && col.id !== (targetNode.data as BoardCardData).stage ? col.id : undefined;
	}
	function onnodedragstop({ targetNode }: { targetNode: Node | null }) {
		const into = ui.dropStage;
		ui.dropStage = undefined;
		if (targetNode?.type === 'card' && into)
			void run(ops.moveToStage(ix, targetNode.id, into as StageId));
		else nodes = built.nodes.map((n) => ({ ...n, selected: n.id === selectedId }));
	}

	// ---- menus ----------------------------------------------------------------------------------
	function addAt(stage: string, x: number, y: number, extra: Partial<AddContext> = {}) {
		pointer = { x, y };
		ui.add = { x, y, stage, ...extra };
	}
	function cardItems(id: string, x: number, y: number): MenuItem[] {
		const item = ix.byId.get(id) as WorkItem;
		return [
			{ label: 'Open details', icon: SquarePen, kbd: 'Enter', run: () => onselect(id) },
			{ label: 'Rename', icon: PencilLine, kbd: 'F2', run: () => (ui.renaming = id) },
			{
				label: 'Add what comes next',
				icon: ListPlus,
				kbd: 'N',
				run: () => addAt(item.core.stage, x, y, { after: id })
			},
			{
				label: item.core.when ? 'Change when it runs' : 'Only run it when…',
				icon: Split,
				run: () => {
					onselect(id);
					if (!item.core.when)
						void run({
							ops: [
								ops.setWhen(id, { text: `Only when ${labelOf(ix, id).toLowerCase()} is needed` })
							],
							label: 'Added a condition; word it under Rules'
						});
				}
			},
			{ sep: true, label: '' },
			...ix.stages
				.filter((s) => s.core.id !== item.core.stage)
				.map((s) => ({
					label: `Move to ${labelOf(ix, s.core.id)}`,
					icon: ArrowRightLeft,
					run: () => void run(ops.moveToStage(ix, id, s.core.id as StageId))
				})),
			{ sep: true, label: '' },
			{ label: 'Duplicate', icon: Copy, run: () => void run(ops.duplicate(ix.document, id)) },
			{ label: 'Delete', icon: Trash2, kbd: 'Del', danger: true, run: () => removeNode(id) }
		];
	}
	function stageItems(stage: string, x: number, y: number): MenuItem[] {
		const at = ix.stages.findIndex((s) => s.core.id === stage);
		return [
			{ label: 'Add step here', icon: SquareStack, run: () => addAt(stage, x, y) },
			{ label: 'Rename stage', icon: PencilLine, run: () => (ui.renaming = stage) },
			{
				label: 'Move stage left',
				icon: ArrowLeftToLine,
				disabled: at <= 0 ? 'It is already the first stage' : undefined,
				run: () => void run(ops.shiftStage(ix, stage, -1))
			},
			{
				label: 'Move stage right',
				icon: ArrowRightToLine,
				disabled: at >= ix.stages.length - 1 ? 'It is already the last stage' : undefined,
				run: () => void run(ops.shiftStage(ix, stage, 1))
			},
			{ label: 'Add another stage', icon: Columns3, run: () => (ui.addingStage = true) },
			{ sep: true, label: '' },
			{ label: 'Delete stage', icon: Trash2, danger: true, run: () => removeNode(stage) }
		];
	}
	function removeNode(id: string | undefined) {
		if (!id) return;
		const kind = kindOf(id);
		const edit =
			kind === 'step' || kind === 'decision'
				? ops.removeWork(ix, id)
				: kind === 'fact'
					? ops.removeFact(ix, id as FactId)
					: kind === 'stage'
						? ops.removeStage(ix, id)
						: undefined;
		void run(edit).then((ok) => ok && onselect(undefined));
	}

	setBoard(ui, {
		get editable() {
			return editable;
		},
		select: (id) => onselect(id),
		rename: (id, title) => void run(ops.renameNode(ix, id, title)),
		cardMenu: (id, x, y) => {
			onselect(id);
			ui.menu = { x, y, items: cardItems(id, x, y) };
		},
		stageMenu: (id, x, y) => {
			ui.menu = { x, y, title: labelOf(ix, id), items: stageItems(id, x, y) };
		},
		quickAdd: (ctx) => {
			pointer = { x: ctx.x, y: ctx.y };
			ui.add = ctx;
		},
		addStage: (title) => run(ops.addStage(ix.document, title)),
		addFact: (item, title) =>
			void run(ops.addFactByName(ix, item, 'records', title, ops.FACT_KINDS[0].schema)),
		addChoice: (decision, choice) => {
			const d = ix.byId.get(decision) as WorkItem;
			if (d.core.kind !== 'decision') return;
			const outcome = ix.byId.get(d.core.outcome)?.core as { schema: { enum?: unknown[] } };
			const list = Array.isArray(outcome.schema.enum) ? outcome.schema.enum.map(String) : [];
			if (list.includes(choice)) return editor?.refuse(`${choice} is already a choice`);
			void run(ops.setChoices(ix, d.core.outcome, [...list, choice]));
		},
		factTitles: () => ix.facts.map((f) => labelOf(ix, f.core.id)),
		editHandOff: (h, x, y) => {
			ui.picker = { x, y, from: h.from, to: h.to };
		},
		insertStep: (h, x, y) => addAt((ix.byId.get(h.to) as WorkItem).core.stage, x, y, { insert: h })
	});

	// ---- canvas events --------------------------------------------------------------------------
	function onnodeclick({ node }: { node: Node }) {
		if (node.type === 'card') onselect(node.id);
	}
	function onpanecontextmenu({ event }: { event: MouseEvent }) {
		event.preventDefault();
		ui.closePopovers();
		if (!editable) return;
		const { clientX: x, clientY: y } = event;
		const at = flow.screenToFlowPosition({ x, y });
		const near = built.columns.find((c) => at.x >= c.x && at.x <= c.x + c.w);
		const items: MenuItem[] = [];
		if (near)
			items.push({
				label: `Add step to ${labelOf(ix, near.id)}`,
				icon: SquareStack,
				run: () => addAt(near.id, x, y)
			});
		items.push(
			{ label: 'Add stage', icon: Columns3, run: () => (ui.addingStage = true) },
			{ label: 'Add or find anything…', icon: Search, kbd: '/', run: () => (ui.palette = true) },
			{ sep: true, label: '' },
			{
				label: 'Fit to screen',
				icon: Maximize,
				run: () => void flow.fitView({ padding: 0.12, minZoom: 0.5, duration: 250 })
			}
		);
		ui.menu = { x, y, items };
	}
	function onnodecontextmenu({ node, event }: { node: Node; event: MouseEvent }) {
		event.preventDefault();
		ui.closePopovers();
		if (!editable) return;
		if (node.type === 'card') {
			onselect(node.id);
			ui.menu = {
				x: event.clientX,
				y: event.clientY,
				title: labelOf(ix, node.id),
				items: cardItems(node.id, event.clientX, event.clientY)
			};
		} else if (node.type === 'stage') {
			ui.menu = {
				x: event.clientX,
				y: event.clientY,
				title: labelOf(ix, node.id),
				items: stageItems(node.id, event.clientX, event.clientY)
			};
		} else if (node.id === GHOST_ID) onpanecontextmenu({ event });
	}
	function onedgecontextmenu({ edge, event }: { edge: Edge; event: MouseEvent }) {
		event.preventDefault();
		if (!editable) return;
		const h = (edge.data as BoardEdgeData).handoff;
		const { clientX: x, clientY: y } = event;
		ui.menu = {
			x,
			y,
			title: `${labelOf(ix, h.from)} → ${labelOf(ix, h.to)}`,
			items: [
				{
					label: 'Change what is handed over',
					icon: Link2,
					run: () => {
						ui.picker = { x, y, from: h.from, to: h.to };
					}
				},
				{
					label: 'Put a step in between',
					icon: Plus,
					run: () => addAt((ix.byId.get(h.to) as WorkItem).core.stage, x, y, { insert: h })
				},
				{ sep: true, label: '' },
				{
					label: 'Remove link',
					icon: Unlink,
					danger: true,
					run: () => void run(ops.unlinkHandOff(ix, h))
				}
			]
		};
	}
	function onedgeclick({ edge, event }: { edge: Edge; event: MouseEvent }) {
		if (!editable) return;
		const h = (edge.data as BoardEdgeData).handoff;
		ui.picker = { x: event.clientX + 8, y: event.clientY + 8, from: h.from, to: h.to };
	}

	// ---- keyboard -----------------------------------------------------------------------------
	function addNext(kind: 'step' | 'decision') {
		const sel = selectedId;
		if (isWork(sel)) {
			const r = document
				.querySelector(`.svelte-flow__node[data-id="${sel}"]`)
				?.getBoundingClientRect();
			addAt((ix.byId.get(sel!) as WorkItem).core.stage, (r?.right ?? 400) + 12, r?.top ?? 200, {
				after: sel,
				kind
			});
			return;
		}
		const stage = kindOf(sel) === 'stage' ? sel! : ix.stages.at(-1)?.core.id;
		if (!stage) {
			ui.addingStage = true;
			return;
		}
		const r = document
			.querySelector(`.svelte-flow__node[data-id="${stage}"]`)
			?.getBoundingClientRect();
		addAt(stage, (r?.left ?? 300) + 16, (r?.top ?? 200) + 60, { kind });
	}
	$effect(() => {
		if (ui.addingStage) reveal(GHOST_ID);
	});
	function onkey(e: KeyboardEvent) {
		if (!editable) return;
		if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]'))
			return;
		const meta = e.metaKey || e.ctrlKey;
		if (meta && e.key.toLowerCase() === 'z' && !e.shiftKey) {
			if (!editor?.undoable) return;
			e.preventDefault();
			void editor.undo();
		} else if (e.key === '/' && !meta) {
			e.preventDefault();
			ui.palette = true;
		} else if (e.key === 'Escape') {
			if (ui.menu || ui.add || ui.picker) ui.closePopovers();
			else onselect(undefined);
		} else if ((e.key === 'n' || e.key === 'd') && !meta && !e.altKey) {
			e.preventDefault();
			addNext(e.key === 'n' ? 'step' : 'decision');
		} else if (
			(e.key === 'Enter' || e.key === 'F2') &&
			selectedId &&
			(isWork(selectedId) || kindOf(selectedId) === 'stage')
		) {
			e.preventDefault();
			ui.renaming = selectedId;
		} else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
			e.preventDefault();
			removeNode(selectedId);
		}
	}

	// ---- palette ------------------------------------------------------------------------------
	const commands = $derived<Command[]>([
		...ix.stages.map((s) => ({
			group: 'Add',
			label: `Step in ${labelOf(ix, s.core.id)}`,
			icon: SquareStack,
			run: () => addNextTo(s.core.id)
		})),
		{ group: 'Add', label: 'Stage', icon: Columns3, run: () => (ui.addingStage = true) },
		...ix.work.map((w) => ({
			group: 'Go to',
			label: labelOf(ix, w.core.id),
			hint: labelOf(ix, w.core.stage),
			icon: w.core.kind === 'decision' ? Signpost : SquareStack,
			run: () => onselect(w.core.id)
		})),
		...ix.facts.map((f) => ({
			group: 'Go to',
			label: labelOf(ix, f.core.id),
			hint: 'fact',
			icon: Info,
			run: () => onselect(f.core.id)
		})),
		...ix.stages.map((s) => ({
			group: 'Go to',
			label: labelOf(ix, s.core.id),
			hint: 'stage',
			icon: Columns3,
			run: () => onselect(s.core.id)
		}))
	]);
	function addNextTo(stage: string) {
		const r = document
			.querySelector(`.svelte-flow__node[data-id="${stage}"]`)
			?.getBoundingClientRect();
		addAt(stage, (r?.left ?? 300) + 16, (r?.top ?? 200) + 60);
	}

	// ---- opening view and tips ----------------------------------------------------------------
	let opened = false;
	$effect(() => {
		if (opened || !nodes.length || !wrap) return;
		opened = true;
		const right = Math.max(...nodes.map((n) => n.position.x + (n.width ?? 0)));
		const bottom = Math.max(...nodes.map((n) => n.position.y + (n.height ?? 0)));
		const w = wrap.clientWidth;
		const h = wrap.clientHeight;
		// open readable: fit when the process is small, else left-aligned at 85%
		const fit = Math.min((w - 80) / right, (h - 160) / bottom, 1);
		const zoom = Math.max(fit, 0.85);
		const x = fit >= 0.85 ? (w - right * zoom) / 2 : 40;
		const y = Math.max(28, (h - 110 - bottom * zoom) / 2);
		void tick().then(() => flow.setViewport({ x, y, zoom }));
	});
	let tips = $state(true);
	$effect(() => {
		try {
			if (localStorage.getItem('casebook-board-tips') === 'off') tips = false;
		} catch {
			/* storage can be unavailable */
		}
	});
	function setTips(on: boolean) {
		tips = on;
		try {
			localStorage.setItem('casebook-board-tips', on ? 'on' : 'off');
		} catch {
			/* storage can be unavailable */
		}
	}
</script>

<svelte:window onkeydown={onkey} />

<div class={['h-full w-full bg-canvas', ui.connecting && 'cb-connecting']} bind:this={wrap}>
	<SvelteFlow
		bind:nodes
		bind:edges
		{nodeTypes}
		{edgeTypes}
		minZoom={0.2}
		maxZoom={1.6}
		nodesDraggable={editable}
		nodesConnectable={editable}
		clickConnect={false}
		deleteKey="F20"
		zoomOnDoubleClick={false}
		panOnScroll
		zoomOnScroll={false}
		nodeDragThreshold={4}
		connectionRadius={36}
		fitViewOptions={{ padding: 0.12, minZoom: 0.5 }}
		onbeforeconnect={() => null}
		onconnectstart={() => {
			ui.connecting = true;
			ui.closePopovers();
		}}
		{onconnectend}
		{onnodeclick}
		{onnodecontextmenu}
		{onpanecontextmenu}
		{onedgecontextmenu}
		{onedgeclick}
		onnodedragstart={() => ui.closePopovers()}
		{onnodedrag}
		{onnodedragstop}
		onpaneclick={() => {
			ui.closePopovers();
			onselect(undefined);
		}}
	>
		<Background gap={18} size={1.4} bgColor="var(--canvas)" patternColor="var(--canvas-dot)" />
		<Controls showLock={false} position="bottom-right" />
		{#if editable}
			<Panel position="bottom-center">
				<div class="mb-2 flex items-center gap-1 rounded-2xl border bg-background p-1 shadow-md">
					<button
						class="flex h-9 cursor-pointer items-center gap-1.5 rounded-xl px-3 text-[12.5px] hover:bg-muted"
						title="Add a step (N)"
						onclick={() => addNext('step')}><SquareStack class="size-4" />Step</button
					>
					<button
						class="flex h-9 cursor-pointer items-center gap-1.5 rounded-xl px-3 text-[12.5px] hover:bg-muted"
						title="Add a decision (D)"
						onclick={() => addNext('decision')}><Signpost class="size-4" />Decision</button
					>
					<button
						class="flex h-9 cursor-pointer items-center gap-1.5 rounded-xl px-3 text-[12.5px] hover:bg-muted"
						title="Add a stage"
						onclick={() => (ui.addingStage = true)}><Columns3 class="size-4" />Stage</button
					>
					<span class="mx-1 h-5 w-px bg-border"></span>
					<button
						class="flex h-9 cursor-pointer items-center gap-2 rounded-xl px-3 text-[12.5px] text-muted-foreground hover:bg-muted hover:text-foreground"
						onclick={() => (ui.palette = true)}
						><Search class="size-4" />Add or find<kbd
							class="rounded-md border bg-background px-1.5 text-[10.5px]">/</kbd
						></button
					>
				</div>
			</Panel>
			<Panel position="bottom-left">
				{#if tips}
					<div class="mb-2 w-64 rounded-2xl border bg-background p-3.5 text-[12px] shadow-md">
						<div class="mb-2 flex items-center gap-2">
							<Info class="size-3.5 text-brand" />
							<span class="flex-1 font-medium">Build right here</span>
							<button
								class="flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
								aria-label="Hide tips"
								onclick={() => setTips(false)}><X class="size-3.5" /></button
							>
						</div>
						<ul class="flex flex-col gap-1.5 text-muted-foreground">
							<li><b class="font-medium text-foreground">Right-click</b> to add</li>
							<li><b class="font-medium text-foreground">+</b> on a card adds what comes next</li>
							<li>
								<b class="font-medium text-foreground">Drag a dot</b> onto a step to link it, or into
								space to add one
							</li>
							<li>
								<b class="font-medium text-foreground">Drag a card</b> onto a stage to move it
							</li>
							<li><b class="font-medium text-foreground">Double-click</b> a name to rename it</li>
							<li>
								<b class="font-medium text-foreground">/</b> to add or find anything,
								<b class="font-medium text-foreground">⌘Z</b> to undo
							</li>
						</ul>
					</div>
				{:else}
					<button
						class="mb-2 flex size-8 cursor-pointer items-center justify-center rounded-lg border bg-background text-muted-foreground shadow-xs hover:text-foreground"
						aria-label="Show tips"
						onclick={() => setTips(true)}><Info class="size-4" /></button
					>
				{/if}
			</Panel>
		{:else if legend}
			<Panel position="bottom-left">{@render legend()}</Panel>
		{/if}
	</SvelteFlow>
</div>

{#if ui.menu}<Menu menu={ui.menu} onclose={() => (ui.menu = undefined)} />{/if}
{#if ui.add}
	{@const ctx = ui.add}
	<QuickAdd
		{ctx}
		{ix}
		onadd={(kind, title, needs) =>
			void create({
				kind,
				title,
				stage: ctx.stage,
				after: ctx.after,
				fact: ctx.fact,
				branch: ctx.branch,
				insert: ctx.insert,
				needs
			})}
		onlink={(target) => {
			const handle = ctx.fact ? `f:${ctx.fact}` : ctx.branch ? `b:${ctx.branch.choice}` : 'out';
			const from =
				ctx.after ??
				ctx.branch?.decision ??
				ix.work.find((w) => collectsOf(w).some((c) => c.fact === ctx.fact))?.core.id;
			if (from) void link(from, handle, target, ctx.x, ctx.y);
		}}
		onclose={() => (ui.add = undefined)}
	/>
{/if}
{#if ui.picker}<LinkBox
		state={ui.picker}
		{ix}
		edit={run}
		onclose={() => (ui.picker = undefined)}
	/>{/if}
{#if ui.palette}<Palette {commands} onclose={() => (ui.palette = false)} />{/if}

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
	/* dots are hidden until a card is hovered or selected, so the board stays calm */
	:global(.svelte-flow__handle.cb-in),
	:global(.svelte-flow__handle.cb-hidden) {
		width: 8px;
		height: 8px;
		border: 1.5px solid var(--brand);
		background: var(--card);
		opacity: 0;
		pointer-events: none;
	}
	:global(.svelte-flow__handle.cb-out) {
		width: 12px;
		height: 12px;
		border: 2px solid var(--brand);
		background: var(--card);
		right: -6px;
		opacity: 0;
		z-index: 10;
		transition: opacity 120ms;
	}
	:global(.svelte-flow__handle.cb-row) {
		width: 9px;
		height: 9px;
		border: 1.5px solid var(--brand);
		background: var(--card);
		right: -5px;
		opacity: 0;
		z-index: 10;
		transition: opacity 120ms;
	}
	:global(.svelte-flow__node:hover .cb-out),
	:global(.svelte-flow__node.selected .cb-out),
	:global(.svelte-flow__node:hover .cb-row),
	:global(.svelte-flow__node.selected .cb-row) {
		opacity: 1;
	}
	:global(.svelte-flow__handle.cb-row:hover),
	:global(.svelte-flow__handle.cb-out:hover) {
		background: var(--brand);
		transform: translate(0, -50%) scale(1.25);
	}
	:global(.cb-plus) {
		position: absolute;
		right: -40px;
		width: 22px;
		height: 22px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 8px;
		border: 1px solid var(--color-border);
		background: var(--background);
		color: var(--muted-foreground);
		cursor: pointer;
		opacity: 0;
		transition: opacity 120ms;
		z-index: 5;
	}
	:global(.cb-plus.cb-plus-leaf) {
		opacity: 0.5;
	}
	:global(.cb-plus::before) {
		content: '';
		position: absolute;
		right: 100%;
		top: 50%;
		width: 12px;
		border-top: 1.5px solid var(--brand-ring);
	}
	:global(.svelte-flow__node:hover .cb-plus),
	:global(.svelte-flow__node.selected .cb-plus) {
		opacity: 1;
	}
	:global(.cb-plus:hover) {
		color: white;
		background: var(--brand);
		border-color: var(--brand);
	}
	/* while a link is being drawn, the card under the pointer lights up as the drop target */
	:global(.cb-connecting .svelte-flow__node-card:hover .cb-card) {
		border-color: var(--brand);
		box-shadow: 0 0 0 4px var(--brand-ring);
	}
	:global(.cb-connecting .svelte-flow__handle.cb-out),
	:global(.cb-connecting .svelte-flow__handle.cb-row) {
		opacity: 1;
	}
	:global(.svelte-flow__connectionline path) {
		stroke: var(--brand);
		stroke-width: 1.75;
		stroke-dasharray: 5 4;
	}
</style>
