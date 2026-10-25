import { describe, expect, it } from 'vitest';
import { caseVerbs, processVerbs, taskVerbs } from './actions';

const allow = { allowed: true, reason: '' };
const deny = { allowed: false, reason: 'user "Rae Reader" cannot edit it' };
const process = {
	slug: 'spouse-citizenship',
	namespace: 'personal/example-user/family',
	status: 'published' as const,
	canEdit: allow
};

describe('the verbs each object offers', () => {
	it('gives a process Overview, Edit on the board, Start a case, Cases and Copy link', () => {
		const verbs = processVerbs('example-family', process);
		expect(verbs.map((v) => v.label)).toEqual([
			'Overview',
			'Edit on the board',
			'Start a case',
			'Cases',
			'Copy link'
		]);
		expect(verbs.find((v) => v.id === 'edit')?.href).toBe(
			'/i/example-family/processes/edit?ws=personal%2Fexample-user%2Ffamily&p=spouse-citizenship'
		);
		expect(verbs.find((v) => v.id === 'start')?.href).toBe(
			'/i/example-family/cases/new?process=spouse-citizenship'
		);
		expect(verbs.find((v) => v.id === 'cases')?.href).toBe(
			'/i/example-family/processes/spouse-citizenship/cases'
		);
	});

	it('offers the board read-only to someone who cannot edit', () => {
		const edit = processVerbs('example-family', { ...process, canEdit: deny }).find(
			(v) => v.id === 'edit'
		);
		expect(edit?.label).toBe('View on the board');
		expect(edit?.disabled).toBeUndefined();
	});

	it('keeps Start a case on a draft, disabled, with the reason', () => {
		const start = processVerbs('example-family', { ...process, status: 'draft' }).find(
			(v) => v.id === 'start'
		);
		expect(start?.disabled).toBe('Publish it first: cases only run published versions.');
		const refused = processVerbs('example-family', {
			...process,
			canStart: { allowed: false, reason: 'Needs a role in this process' }
		}).find((v) => v.id === 'start');
		expect(refused?.disabled).toBe('Needs a role in this process');
	});

	it('gives a case and a task the same verbs wherever they appear', () => {
		expect(caseVerbs('example-family', { id: 'case-mira' }).map((v) => v.label)).toEqual([
			'Open case',
			'Case record',
			'Add a process',
			'Copy link'
		]);
		const task = taskVerbs('example-family', {
			caseId: 'case-mira',
			attachmentId: 'run-birth',
			item: 'step.complete-form',
			definitionSlug: 'birth-registration-abroad'
		});
		expect(task.map((v) => v.label)).toEqual([
			'Open task',
			'Open case',
			'View whole process',
			'Open process',
			'Copy link'
		]);
		expect(task.find((v) => v.id === 'process')?.href).toBe(
			'/i/example-family/processes/birth-registration-abroad'
		);
		expect(task[0]?.href).toBe('/i/example-family/c/case-mira/t/run-birth/step.complete-form');
	});
});
