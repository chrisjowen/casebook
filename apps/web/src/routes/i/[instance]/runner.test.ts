import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import WorkPage from './+page.svelte';
import CasePage from './c/[case]/+page.svelte';
import TaskPage from './c/[case]/t/[attachment]/[item]/+page.svelte';
import type { CaseView } from '@casebook/store';
import {
	acme,
	alex,
	dana,
	family,
	sam,
	stages,
	task,
	taskView,
	user,
	work
} from '$lib/runner/test-data';

vi.mock('$app/state', () => ({
	page: { url: new URL('http://localhost/i/example-family') }
}));

const frame = { user, instance: family, instances: [acme, family] };
const text = (html: string) =>
	html
		.replace(/<!--.*?-->/g, '')
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ');

describe('My work', () => {
	const page = (w = work()) =>
		text(render(WorkPage, { props: { data: { ...frame, work: w }, params: {} } as never }).body);

	it('groups work in a fixed order: ready, needs information, waiting, then recurring', () => {
		const html = page(
			work({
				ready: [task({ started: [{ by: sam, at: '2026-10-24T10:00:00Z' }] })],
				held: [
					task({
						item: 'step.provide-marriage-certificate',
						title: 'Upload the marriage certificate',
						status: 'held',
						held: { by: alex, at: '2026-10-14T17:20:00Z', note: 'The apostille hasn’t come back' }
					})
				],
				waiting: [
					{
						caseId: 'case-mira',
						caseTitle: 'Mira Example',
						attachmentId: 'run-claim',
						process: 'Claim a medical bill · Delivery bill',
						definitionSlug: 'medical-bill-claim',
						stage: { number: 1, count: 4, title: 'Collect the bill' },
						on: [
							{
								title: 'Send the itemised invoice',
								holders: [dana],
								held: {
									by: dana,
									at: '2026-10-20T09:00:00Z',
									note: 'Billing is closed until Monday'
								}
							}
						],
						myPartDone: true
					}
				],
				recurring: [
					task({
						title: 'Post a status update',
						repeating: true,
						due: '2026-10-25T06:00:00Z',
						overdue: true
					})
				]
			})
		);
		const order = ['Ready for you', 'Needs information', 'Waiting on someone else', 'Recurring'];
		const positions = order.map((title) => html.indexOf(title));
		expect(positions.every((p) => p >= 0)).toBe(true);
		expect([...positions].sort((a, b) => a - b)).toEqual(positions);
		expect(html).toContain('2 things need you in Example family.');
		expect(html).toContain('Sam Example started this');
		expect(html).toContain('“The apostille hasn’t come back” — you, 14 Oct');
		expect(html).toContain('Dana Cole — send the itemised invoice');
		// Pausing notifies whoever is waiting on the work: here, the note itself.
		expect(html).toContain('Paused by Dana Cole, 20 Oct: “Billing is closed until Monday”');
		expect(html).toContain('Your part is done for now.');
		expect(html).toMatch(/Recurring · next was due/);
	});

	it('does not tell people that they started a task themselves', () => {
		const html = page(
			work({ ready: [task({ started: [{ by: alex, at: '2026-10-24T10:00:00Z' }] })] })
		);
		expect(html).not.toContain('started this');
	});

	it('says when nothing needs the user', () => {
		const html = page();
		expect(html).toContain('Nothing needs you in Example family right now.');
		expect(html).toContain('You’re all caught up');
	});

	it('switches between Work and Processes, and to the Cases tab', () => {
		const html = render(WorkPage, {
			props: { data: { ...frame, work: work() }, params: {} } as never
		}).body;
		expect(html).toContain('href="/i/example-family/processes"');
		expect(html).toContain('href="/i/example-family/cases"');
		expect(html).toMatch(/aria-current="page"[^>]*>Work</);
	});
});

describe('a case', () => {
	const view: CaseView = {
		instance: family,
		id: 'case-mira',
		title: 'Mira Example',
		subject: 'Newborn, born abroad on 12 Sept 2026',
		openedAt: '2026-09-15T10:00:00Z',
		openedBy: alex,
		mine: [task()],
		processes: [
			{
				id: 'run-claim',
				name: 'Claim a medical bill · Delivery bill',
				definitionId: 'def-claim',
				definitionSlug: 'medical-bill-claim',
				namespace: 'personal/example-user/family',
				version: 1,
				latestVersion: 1,
				binding: 'follow_latest',
				stages: stages(0, [
					'Collect the bill',
					'Submit the claim',
					'Insurer review',
					'Reimbursement'
				]),
				line: { number: 1, count: 4, title: 'Collect the bill' },
				complete: false,
				others: 'Your part is done for now. Waiting on Dana Cole — send the itemised invoice.',
				startedAt: '2026-10-05T10:00:00Z',
				items: [],
				document: { schemaVersion: 1, namespace: 'x', slug: 'x', version: 1, nodes: [] }
			}
		],
		record: [
			{
				fact: 'fact.patient-name',
				title: 'Patient name',
				display: 'Mira Example',
				at: '2026-10-05T10:00:00Z',
				by: alex,
				sharedBy: []
			}
		],
		can: { addProcess: false, moveVersions: { allowed: false, reason: 'no' } }
	};
	const page = (c: CaseView) =>
		text(render(CasePage, { props: { data: { ...frame, case: c }, params: {} } as never }).body);

	it('shows the user’s tasks, one stage strip per process, what others are doing, and the record', () => {
		const html = page(view);
		expect(html).toContain('Your tasks in this case');
		expect(html).toContain('Complete the application form');
		expect(html).toContain('Claim a medical bill · Delivery bill');
		expect(html).toContain('Collect the bill Submit the claim Insurer review Reimbursement');
		expect(html).toContain('Waiting on Dana Cole — send the itemised invoice.');
		expect(html).toContain('View whole process');
		expect(html).toContain('Patient name · Mira Example');
		expect(html).not.toContain('Add a process');
		expect(page({ ...view, can: { ...view.can, addProcess: true } })).toContain('Add a process');
	});
});

describe('a task', () => {
	const page = (view = taskView(), form: unknown = null) =>
		text(
			render(TaskPage, {
				props: {
					data: {
						...frame,
						case: { id: 'case-mira', title: 'Mira Example' },
						task: view,
						demoFiles: true
					},
					form,
					params: {}
				} as never
			}).body
		);

	it('says who does it, what it uses with where it came from, and what to record', () => {
		const html = page();
		expect(html).toContain('You’re doing this as parent; Sam Example can also do it.');
		expect(html).toContain('What this uses');
		expect(html).toContain('Mira Example Alex Example, 20 Sept · Register the birth locally');
		expect(html).toContain('Country of birth Not recorded yet');
		expect(html).toContain('Parents’ passport numbers');
		expect(html).toContain('or use a demo document');
		expect(html).toContain('Complete task');
		expect(html).toContain('I can’t finish this yet');
	});

	it('shows the problems a refused form came back with', () => {
		const html = page(taskView(), {
			reason: 'x',
			problems: { 'fact.application-form': 'Completed application form is needed' }
		});
		expect(html).toContain('Some things need another look');
		expect(html).toContain('Completed application form is needed');
	});

	it('explains waiting on someone else, and offers no buttons', () => {
		const html = page(
			taskView({
				task: task({
					status: 'waiting',
					waitingOn: { title: 'Register the birth locally', holders: [sam] }
				})
			})
		);
		expect(html).toContain('Waiting on Sam Example to register the birth locally.');
		expect(html).not.toContain('Complete task');
	});

	it('asks an approver to sign off or send back, and tells others who it is for', () => {
		const approval = taskView({
			task: task({ kind: 'approval', title: 'Sign off the RCA', item: 'approval.rca-sign-off' }),
			reviews: { title: 'Write the root cause analysis', doneBy: sam },
			fields: []
		});
		const html = page(approval);
		expect(html).toContain('Reviews “Write the root cause analysis”, done by Sam Example.');
		expect(html).toContain('Sign off');
		expect(html).toContain('Send back with changes');
		const other = page({ ...approval, you: { ...approval.you, canAct: false } });
		expect(other).toContain('This is for Alex Example or Sam Example');
		expect(other).not.toContain('Submit review');
	});

	it('lets the role skip work whose condition is prose only', () => {
		const html = page(
			taskView({ canSkip: true, guard: { text: 'Always for SEV1 and SEV2', state: 'open' } })
		);
		expect(html).toContain('When: always for SEV1 and SEV2.');
		expect(html).toContain('This doesn’t apply');
	});
});
