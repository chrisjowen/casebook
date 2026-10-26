<script lang="ts">
	// New process, from the New menu or the palette: a name, where it lives and how changes go
	// live, then straight onto the new process's board.
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { Dialog } from 'bits-ui';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import X from '@lucide/svelte/icons/x';
	import { links } from '$lib/runner/links';
	import type { ShellSpace } from './types';

	let {
		open = $bindable(false),
		instance,
		spaces,
		preferred
	}: {
		open?: boolean;
		instance: string;
		spaces: ShellSpace[];
		/** The workspace to offer first. */
		preferred?: string;
	} = $props();

	const writable = $derived(spaces.filter((s) => s.canCreate.allowed));
	let space = $state('');
	let busy = $state(false);
	let problem = $state<string | undefined>();
	$effect(() => {
		if (open) {
			problem = undefined;
			space = writable.find((s) => s.id === preferred)?.id ?? writable[0]?.id ?? '';
		}
	});
	const namespace = $derived(writable.find((s) => s.id === space)?.namespace);

	const label = 'mb-1.5 block text-[13px] font-medium';
	const field =
		'h-10 w-full rounded-lg border bg-background px-3 text-[14px] outline-none focus:ring-2 focus:ring-brand-ring';
</script>

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Overlay class="fixed inset-0 z-[60] bg-foreground/15" />
		<Dialog.Content
			class="fixed top-[14vh] left-1/2 z-[60] w-[min(460px,calc(100%-32px))] -translate-x-1/2 rounded-2xl border bg-popover p-5 shadow-xl outline-none"
		>
			<div class="flex items-start gap-3">
				<div class="min-w-0 flex-1">
					<Dialog.Title class="text-[16px] font-semibold">New process</Dialog.Title>
					<Dialog.Description class="mt-1 text-[13px] text-muted-foreground">
						It opens on the board with a first stage and step to build on. Nothing runs it until you
						publish.
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
				<form
					method="POST"
					action="{links.editor(instance)}?/create"
					class="mt-5 flex flex-col gap-4"
					use:enhance={() => {
						busy = true;
						problem = undefined;
						return async ({ result }) => {
							busy = false;
							if (result.type === 'success' && typeof result.data?.slug === 'string') {
								open = false;
								await goto(links.editor(instance, namespace, result.data.slug), {
									invalidateAll: true
								});
							} else if (result.type === 'failure') {
								problem = String(result.data?.reason ?? 'The process was not created');
							} else if (result.type === 'error') {
								problem = result.error?.message ?? 'The process was not created';
							}
						};
					}}
				>
					<div>
						<label class={label} for="new-process-title">Name</label>
						<!-- svelte-ignore a11y_autofocus -->
						<input
							id="new-process-title"
							name="title"
							class={field}
							placeholder="For example: Onboard a supplier"
							required
							autofocus
						/>
					</div>
					{#if writable.length > 1}
						<div>
							<label class={label} for="new-process-space">Where</label>
							<select
								id="new-process-space"
								name="namespaceId"
								class={[field, 'cursor-pointer']}
								bind:value={space}
							>
								{#each writable as s (s.id)}<option value={s.id}
										>{writable.filter((w) => w.label === s.label).length > 1
											? `${s.label} · ${s.namespace}`
											: s.label}</option
									>{/each}
							</select>
						</div>
					{:else}
						<input type="hidden" name="namespaceId" value={space} />
					{/if}
					<fieldset>
						<legend class={label}>When changes go live</legend>
						<div class="grid gap-2 sm:grid-cols-2">
							{#each [{ value: 'governed', title: 'When you publish', hint: 'Governed: edit a draft, publish when ready' }, { value: 'living', title: 'Straight away', hint: 'Living: every edit publishes' }] as option, i (option.value)}
								<label
									class="flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 has-checked:border-brand has-checked:bg-brand-soft"
								>
									<input
										type="radio"
										name="changePolicy"
										value={option.value}
										checked={i === 0}
										class="mt-1 accent-[var(--brand)]"
									/>
									<span>
										<span class="block text-[13px] font-medium">{option.title}</span>
										<span class="block text-[12px] text-muted-foreground">{option.hint}</span>
									</span>
								</label>
							{/each}
						</div>
					</fieldset>
					{#if problem}<p class="text-[13px] text-destructive" role="alert">{problem}</p>{/if}
					<div class="flex justify-end gap-2">
						<Dialog.Close
							type="button"
							class="h-9 cursor-pointer rounded-lg px-3.5 text-[13px] text-muted-foreground hover:bg-muted"
							>Cancel</Dialog.Close
						>
						<button
							class="flex h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-foreground px-4 text-[13px] font-medium text-background hover:bg-foreground/90 disabled:opacity-50"
							disabled={busy}
							>{#if busy}<LoaderCircle class="size-4 animate-spin" />{/if}Create and open the board</button
						>
					</div>
				</form>
			{/if}
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
