<script lang="ts">
	// Import a spreadsheet, from the New menu or the palette: the assistant reads the sheet,
	// suggests processes and drafts them on the board. Carries on with an earlier import too.
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Dialog } from 'bits-ui';
	import Download from '@lucide/svelte/icons/download';
	import FileSpreadsheet from '@lucide/svelte/icons/file-spreadsheet';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import X from '@lucide/svelte/icons/x';
	import { day } from '$lib/runner/format';
	import { links } from '$lib/runner/links';
	import type { ShellImport, ShellSpace } from './types';

	let {
		open = $bindable(false),
		instance,
		spaces,
		imports,
		preferred
	}: {
		open?: boolean;
		instance: string;
		spaces: ShellSpace[];
		imports: ShellImport[];
		/** The workspace to offer first. */
		preferred?: string;
	} = $props();

	const writable = $derived(spaces.filter((s) => s.canCreate.allowed));
	let space = $state('');
	let uploading = $state(false);
	let chosen = $state(false);
	let problem = $state<string | undefined>();
	$effect(() => {
		if (open) {
			problem = undefined;
			space = writable.find((s) => s.id === preferred)?.id ?? writable[0]?.id ?? '';
		}
	});

	async function start(body: FormData) {
		const target = writable.find((s) => s.id === space);
		if (!target) return;
		body.set('namespaceId', target.id);
		uploading = true;
		problem = undefined;
		try {
			const response = await fetch(resolve('/wizard'), { method: 'POST', body });
			const result = await response.json();
			if (!result.ok) {
				problem = result.reason ?? 'The import did not start';
				return;
			}
			open = false;
			await goto(links.editor(instance, target.namespace, undefined, { wizard: result.id }), {
				invalidateAll: true
			});
		} catch (error) {
			problem = error instanceof Error ? error.message : String(error);
		} finally {
			uploading = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Overlay class="fixed inset-0 z-[60] bg-foreground/15" />
		<Dialog.Content
			class="fixed top-[14vh] left-1/2 z-[60] w-[min(480px,calc(100%-32px))] -translate-x-1/2 rounded-2xl border bg-popover p-5 shadow-xl outline-none"
		>
			<div class="flex items-start gap-3">
				<div class="min-w-0 flex-1">
					<Dialog.Title class="text-[16px] font-semibold">Import a spreadsheet</Dialog.Title>
					<Dialog.Description class="mt-1 text-[13px] text-muted-foreground">
						The assistant reads the sheet, suggests processes and drafts them on the board. Nothing
						is created or changed until you accept it.
					</Dialog.Description>
				</div>
				<Dialog.Close
					class="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
					aria-label="Close"><X class="size-4" /></Dialog.Close
				>
			</div>
			{#if writable.length === 0}
				<p class="mt-4 rounded-lg bg-muted px-3 py-2.5 text-[13px] text-muted-foreground">
					{spaces[0]?.canCreate.reason ??
						'You cannot create processes here. Ask an account owner for access.'}
				</p>
			{:else}
				<div class="mt-5 flex flex-col gap-4">
					{#if writable.length > 1}
						<div>
							<label class="mb-1.5 block text-[13px] font-medium" for="import-space">Where</label>
							<select
								id="import-space"
								class="h-10 w-full cursor-pointer rounded-lg border bg-background px-3 text-[14px] outline-none focus:ring-2 focus:ring-brand-ring"
								bind:value={space}
							>
								{#each writable as s (s.id)}<option value={s.id}
										>{writable.filter((w) => w.label === s.label).length > 1
											? `${s.label} · ${s.namespace}`
											: s.label}</option
									>{/each}
							</select>
						</div>
					{/if}
					<form
						class="flex flex-wrap items-center gap-2"
						onsubmit={(e) => {
							e.preventDefault();
							void start(new FormData(e.currentTarget));
						}}
					>
						<label class="sr-only" for="import-file">Spreadsheet (.xlsx)</label>
						<input
							id="import-file"
							type="file"
							name="file"
							accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
							required
							onchange={(e) => (chosen = !!e.currentTarget.files?.length)}
							class="min-w-0 flex-1 text-[13px] file:mr-2 file:cursor-pointer file:rounded-md file:border file:bg-background file:px-2.5 file:py-1.5"
						/>
						<button
							class="h-9 cursor-pointer rounded-lg bg-foreground px-4 text-[13px] font-medium text-background hover:bg-foreground/90 disabled:opacity-50"
							disabled={uploading || !chosen}>Import</button
						>
					</form>
					<div class="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2.5 text-[13px]">
						<FileSpreadsheet class="size-4 shrink-0 text-muted-foreground" />
						<span class="min-w-0 flex-1 text-muted-foreground"
							>No sheet to hand? Try the sample.</span
						>
						<button
							class="h-8 cursor-pointer rounded-lg border bg-background px-3 font-medium hover:bg-muted disabled:opacity-50"
							disabled={uploading}
							onclick={() => {
								const body = new FormData();
								body.set('sample', '1');
								void start(body);
							}}>Use the sample</button
						>
						<a
							href={resolve('/wizard/sample')}
							download
							class="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-background"
							title="Download the sample"
							aria-label="Download the sample"><Download class="size-4" /></a
						>
					</div>
					{#if uploading}<p class="flex items-center gap-1.5 text-[13px] text-muted-foreground">
							<LoaderCircle class="size-4 animate-spin" />Reading the spreadsheet…
						</p>{/if}
					{#if problem}<p class="text-[13px] text-destructive" role="alert">{problem}</p>{/if}
					{#if imports.length}
						<div class="border-t pt-3">
							<p class="mb-1 text-[12px] font-medium text-muted-foreground">
								Carry on with an import
							</p>
							<ul>
								{#each imports.slice(0, 5) as imp (imp.id)}
									<li>
										<a
											href={links.editor(instance, imp.namespace, undefined, { wizard: imp.id })}
											onclick={() => (open = false)}
											class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] hover:bg-muted"
										>
											<FileSpreadsheet class="size-4 shrink-0 text-muted-foreground" />
											<span class="min-w-0 flex-1 truncate">{imp.fileName}</span>
											<span class="shrink-0 text-[12px] text-muted-foreground"
												>{imp.processes
													? `${imp.processes} ${imp.processes === 1 ? 'process' : 'processes'}`
													: 'choosing processes'} · {day(imp.updatedAt)}</span
											>
										</a>
									</li>
								{/each}
							</ul>
						</div>
					{/if}
				</div>
			{/if}
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
