import type { LoadedDefinition } from '$lib/definitions/types';

/** Why the draft cannot be published now, or undefined when it can. Living drafts never are. */
export function publishBlocked(d: LoadedDefinition): string | undefined {
	if (d.policy === 'living') return 'Every edit of a living process is already published';
	if (!d.can.publish.allowed) return 'Publishing it needs someone who can publish processes here';
	if (d.revision === undefined) return 'There is no draft to publish';
	if (!d.document.nodes.some((n) => n.core.kind === 'step' || n.core.kind === 'decision')) {
		return 'Add a step first: a process with no steps has nothing for a case to do';
	}
	if (d.published && d.changes.length === 0) {
		return `Nothing has changed since version ${d.published.version}`;
	}
	const failing = d.errors.length + d.issues.filter((i) => i.severity === 'error').length;
	if (failing > 0) {
		return `Fix the ${failing === 1 ? 'problem' : `${failing} problems`} in the publish checks first`;
	}
	if (d.requiresApproval) {
		return 'This process needs an approval before publishing, which casebook cannot record yet';
	}
	return undefined;
}

/** "3 changes since version 2", "Not published yet" or "Published as version 2". */
export function draftStatus(d: LoadedDefinition): string {
	if (!d.published) return 'Not published yet';
	if (d.changes.length === 0) return `Published as version ${d.published.version}`;
	const n = d.changes.length;
	return `${n} ${n === 1 ? 'change' : 'changes'} since version ${d.published.version}`;
}
