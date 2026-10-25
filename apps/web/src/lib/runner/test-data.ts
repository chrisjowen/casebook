/**
 * Runner view data for component tests, shaped as `@casebook/store` returns it, without a
 * database. Names and values are synthetic (ADR 0014).
 */
import type { StageState } from '@casebook/model';
import type { Instance, TaskSummary, TaskView, WorkView } from '@casebook/store';

export const alex = { id: 'alex', name: 'Alex Example' };
export const sam = { id: 'sam', name: 'Sam Example' };
export const dana = { id: 'dana', name: 'Dana Cole' };

export const user = { id: 'alex', displayName: 'Alex Example', roles: ['account-owner of family'] };

export const family: Instance = {
	slug: 'example-family',
	name: 'Example family',
	role: 'account-owner',
	waitingOnYou: 2
};
export const acme: Instance = { slug: 'acme', name: 'Acme', role: 'read-only', waitingOnYou: 0 };

export const stages = (current: number, titles: string[]): StageState[] =>
	titles.map((title, i) => ({
		id: `stage.${i}` as `stage.${string}`,
		title,
		state: i < current ? 'done' : i === current ? 'current' : 'upcoming'
	}));

export function task(overrides: Partial<TaskSummary> = {}): TaskSummary {
	return {
		caseId: 'case-mira',
		caseTitle: 'Mira Example',
		attachmentId: 'run-birth',
		process: 'Register a birth abroad',
		definitionSlug: 'birth-registration-abroad',
		item: 'step.complete-application',
		kind: 'step',
		title: 'Complete the application form',
		status: 'ready',
		stage: { index: 1, number: 2, count: 3, title: 'Prepare the application' },
		role: 'Parent',
		holders: [alex, sam],
		started: [],
		repeating: false,
		...overrides
	};
}

export function work(overrides: Partial<WorkView> = {}): WorkView {
	return {
		instance: family,
		asked: [],
		ready: [],
		held: [],
		waiting: [],
		recurring: [],
		cases: [],
		...overrides
	};
}

export function taskView(overrides: Partial<TaskView> = {}): TaskView {
	return {
		instance: family,
		case: { id: 'case-mira', title: 'Mira Example' },
		task: task(),
		you: { canAct: true, reason: 'allowed', role: 'Parent', others: [sam] },
		uses: [
			{
				fact: 'fact.child-name',
				title: 'Child’s full name',
				recorded: {
					fact: 'fact.child-name',
					title: 'Child’s full name',
					display: 'Mira Example',
					at: '2026-09-20T10:12:00.000Z',
					by: alex,
					sharedBy: [],
					from: {
						attachmentId: 'run-birth',
						item: 'step.register-locally',
						title: 'Register the birth locally',
						process: 'Register a birth abroad'
					}
				}
			},
			{ fact: 'fact.country-of-birth', title: 'Country of birth' }
		],
		fields: [
			{
				fact: 'fact.parent-passport-numbers',
				title: 'Parents’ passport numbers',
				kind: 'list',
				multiple: true
			},
			{
				fact: 'fact.application-form',
				title: 'Completed application form',
				kind: 'file',
				multiple: false
			}
		],
		evidence: [],
		canSkip: false,
		questions: [],
		askable: [dana],
		outline: [],
		process: {
			id: 'run-birth',
			name: 'Register a birth abroad',
			definitionId: 'def-birth',
			definitionSlug: 'birth-registration-abroad',
			namespace: 'personal/example-user/family',
			version: 1,
			latestVersion: 1,
			binding: 'follow_latest',
			stages: stages(1, ['Local registration', 'Prepare the application', 'Consular registration']),
			line: { number: 2, count: 3, title: 'Prepare the application' },
			complete: false
		},
		...overrides
	};
}
