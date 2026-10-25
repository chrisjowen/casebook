import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { checkPublish, type DefinitionDocument } from '@casebook/model';
import {
	incidentManagement,
	uncollectedFact
} from '../../../../../packages/model/fixtures/index.ts';
import { indexDocument } from '$lib/graph/derive';
import ProcessInspector from './ProcessInspector.svelte';

const inspect = (document: DefinitionDocument) => {
	const check = checkPublish(document);
	const loaded = { document, ok: check.ok, errors: check.errors, issues: check.issues };
	return render(ProcessInspector, { props: { ix: indexDocument(document), loaded } }).body;
};

describe('process inspector publish checks', () => {
	it('says a passing definition can be published', () => {
		expect(inspect(incidentManagement)).toContain('All checks pass');
	});

	it('lists blocking problems by name, never by node id', () => {
		const html = inspect(uncollectedFact);
		expect(html).toMatch(/problems? blocks? publishing/);
		expect(html).toContain('no step or decision collects it');
		expect(html).not.toMatch(/\b(?:fact|step|decision)\.[a-z]/);
	});
});
