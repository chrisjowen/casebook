/**
 * The verbs each object offers, in one place, so a process, case or task has the same actions in
 * its menu, on its rows and in the command palette. A verb the user may not use stays listed,
 * disabled, with the reason.
 */
import type { Component } from 'svelte';
import type { ResolvedPathname } from '$app/types';
import Briefcase from '@lucide/svelte/icons/briefcase';
import Eye from '@lucide/svelte/icons/eye';
import FileText from '@lucide/svelte/icons/file-text';
import LayoutList from '@lucide/svelte/icons/layout-list';
import Link2 from '@lucide/svelte/icons/link-2';
import ListChecks from '@lucide/svelte/icons/list-checks';
import Play from '@lucide/svelte/icons/play';
import Workflow from '@lucide/svelte/icons/workflow';
import Plus from '@lucide/svelte/icons/plus';
import SquarePen from '@lucide/svelte/icons/square-pen';
import SquareCheck from '@lucide/svelte/icons/square-check';
import { links } from '$lib/runner/links';
import type { Permission } from './types';

export interface Verb {
	/** Stable across objects, such as "edit" or "start", so a page can leave out its own verb. */
	id: string;
	label: string;
	icon: Component;
	href?: ResolvedPathname;
	run?: () => void;
	/** Why the verb is unavailable; the verb is shown disabled when set. */
	disabled?: string;
}

function copyLink(href: string): Verb {
	return {
		id: 'copy',
		label: 'Copy link',
		icon: Link2,
		run: () => void navigator.clipboard?.writeText(new URL(href, location.origin).href)
	};
}

export interface ProcessTarget {
	slug: string;
	namespace: string;
	status: 'published' | 'draft';
	canEdit: Permission;
	/** Known on the process's own pages; elsewhere a draft is refused and the rest are offered. */
	canStart?: Permission;
}

export function processVerbs(instance: string, p: ProcessTarget): Verb[] {
	const start =
		p.canStart ??
		(p.status === 'draft'
			? { allowed: false, reason: 'Publish it first: cases only run published versions.' }
			: { allowed: true, reason: '' });
	return [
		{ id: 'open', label: 'Overview', icon: LayoutList, href: links.process(instance, p.slug) },
		p.canEdit.allowed
			? {
					id: 'edit',
					label: 'Edit on the board',
					icon: SquarePen,
					href: links.editor(instance, p.namespace, p.slug)
				}
			: {
					id: 'edit',
					label: 'View on the board',
					icon: Eye,
					href: links.editor(instance, p.namespace, p.slug)
				},
		{
			id: 'start',
			label: 'Start a case',
			icon: Play,
			href: links.newCase(instance, { process: p.slug }),
			...(start.allowed ? {} : { disabled: start.reason })
		},
		{ id: 'cases', label: 'Cases', icon: Briefcase, href: links.processCases(instance, p.slug) },
		copyLink(links.process(instance, p.slug))
	];
}

export function caseVerbs(instance: string, c: { id: string }): Verb[] {
	return [
		{ id: 'open', label: 'Open case', icon: Briefcase, href: links.case(instance, c.id) },
		{ id: 'record', label: 'Case record', icon: FileText, href: links.record(instance, c.id) },
		{
			id: 'add',
			label: 'Add a process',
			icon: Plus,
			href: links.newCase(instance, { case: c.id })
		},
		copyLink(links.case(instance, c.id))
	];
}

export function taskVerbs(
	instance: string,
	t: { caseId: string; attachmentId: string; item: string; definitionSlug?: string }
): Verb[] {
	const href = links.task(instance, t.caseId, t.attachmentId, t.item);
	return [
		{ id: 'open', label: 'Open task', icon: SquareCheck, href },
		{ id: 'case', label: 'Open case', icon: Briefcase, href: links.case(instance, t.caseId) },
		{
			id: 'whole',
			label: 'View whole process',
			icon: ListChecks,
			href: links.wholeProcess(instance, t.caseId, t.attachmentId)
		},
		...(t.definitionSlug
			? [
					{
						id: 'process',
						label: 'Open process',
						icon: Workflow,
						href: links.process(instance, t.definitionSlug)
					}
				]
			: []),
		copyLink(href)
	];
}
