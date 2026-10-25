import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { checkPublish, type DefinitionDocument } from '@casebook/model';
import { incidentManagement, uncollectedFact } from '@casebook/model/fixtures';
import { indexDocument } from '$lib/graph/derive';
import type { LoadedDefinition } from '$lib/definitions/types';
import ProcessInspector from './ProcessInspector.svelte';

const allowed = { allowed: true, reason: 'allowed' };

const inspect = (document: DefinitionDocument, changes: string[] = []) => {
	const check = checkPublish(document);
	const loaded: LoadedDefinition = {
		id: document.slug,
		document,
		ok: check.ok,
		errors: check.errors,
		issues: check.issues,
		policy: 'governed',
		requiresApproval: false,
		revision: 2,
		undoable: true,
		published: { version: 1, at: '2026-10-25T00:00:00.000Z', by: 'Olive Owner' },
		changes,
		can: { edit: allowed, publish: allowed }
	};
	return render(ProcessInspector, { props: { ix: indexDocument(document), loaded } }).body;
};

describe('process inspector publish checks', () => {
	it('says a passing definition can be published', () => {
		expect(inspect(incidentManagement)).toContain('All checks pass');
	});

	it('lists blocking problems by name, never by node id', () => {
		const html = inspect(uncollectedFact, ['Added a requirement']);
		expect(html).toMatch(/problems? blocks? publishing/);
		expect(html).toContain('no step or decision collects it');
		expect(html).not.toMatch(/\b(?:fact|step|decision)\.[a-z]/);
		expect(html).toMatch(/Fix the .*in the publish checks first/);
	});

	it('lists the draft changes since the published version, by name', () => {
		const html = inspect(incidentManagement, ['Renamed step step.write-rca to Write it up']);
		expect(html).toContain('1 change since version 1');
		expect(html).toContain('Renamed step “Write the root cause analysis” to Write it up');
		expect(html).toContain('Publish version 2');
	});
});
