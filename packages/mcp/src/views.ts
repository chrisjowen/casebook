// What the tools answer with: the runner's reads from `@casebook/store`, reshaped for an agent.
// People are named rather than given as ids, except where an id is something the agent sends back
// (a case, a task, a file, or someone to name in a field). Nothing is added that the signed-in
// user's own screens would not show them; guests keep the store's narrowed views.
import { runnableProcess } from '@casebook/model';
import type {
	AttachmentSummary,
	CaseView,
	GuestRequest,
	Instance,
	Mark,
	PersonView,
	ProcessView,
	RecordEntry,
	RecordedValue,
	TaskSummary,
	TaskView,
	WaitingEntry,
	WorkView
} from '@casebook/store';

const names = (people: PersonView[]) => people.map((p) => p.name);
const note = (m: (Mark & { note: string }) | undefined) =>
	m ? { by: m.by.name, at: m.at, note: m.note } : undefined;

/** Who may do a work item, by its actor policy. */
const DONE_BY: Record<string, string> = {
	human: 'a person, never an agent',
	agent: 'an agent',
	either: 'a person or an agent'
};

const stageText = (s: { number: number; count: number; title: string }) =>
	s.number > s.count
		? `finished (${s.count} stages)`
		: `stage ${s.number} of ${s.count}: ${s.title}`;

/** Drops keys whose value is undefined, so answers carry only what applies. */
function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
	return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export function casebooks(instances: Instance[]) {
	return instances.map((i) => ({
		casebook: i.slug,
		name: i.name,
		yourAccountRole: i.role,
		waitingOnYou: i.waitingOnYou
	}));
}

export function guestRequests(requests: GuestRequest[]) {
	return requests.map((r) => ({
		attachmentId: r.attachmentId,
		item: r.item,
		title: r.title,
		status: r.status,
		askedBy: r.requester,
		for: r.forWhom,
		from: r.from
	}));
}

export function task(t: TaskSummary) {
	return compact({
		attachmentId: t.attachmentId,
		item: t.item,
		title: t.title,
		kind: t.kind,
		status: t.status,
		case: t.caseId ? { id: t.caseId, title: t.caseTitle } : undefined,
		process: t.process || undefined,
		stage: t.stage.count ? stageText(t.stage) : undefined,
		role: t.role || undefined,
		holders: names(t.holders),
		startedBy: t.started.length ? t.started.map((s) => s.by.name) : undefined,
		paused: note(t.held),
		sentBack: note(t.sentBack),
		waitingOn: t.waitingOn
			? compact({
					title: t.waitingOn.title,
					holders: names(t.waitingOn.holders),
					paused: note(t.waitingOn.held)
				})
			: undefined,
		repeating: t.repeating || undefined,
		due: t.due,
		overdue: t.overdue,
		lastDone: t.lastDone ? { by: t.lastDone.by.name, at: t.lastDone.at } : undefined
	});
}

function waiting(w: WaitingEntry) {
	return compact({
		case: { id: w.caseId, title: w.caseTitle },
		attachmentId: w.attachmentId,
		process: w.process,
		stage: stageText(w.stage),
		on: w.on.map((o) =>
			compact({ title: o.title, holders: names(o.holders), paused: note(o.held) })
		),
		yourPartDone: w.myPartDone,
		yourWaitingTask: w.mine ? task(w.mine) : undefined
	});
}

function processLine(a: AttachmentSummary) {
	return {
		attachmentId: a.id,
		name: a.name,
		definition: a.definitionSlug,
		version: a.version,
		stage: stageText(a.line),
		complete: a.complete
	};
}

export function work(view: WorkView) {
	return {
		casebook: view.instance.slug,
		name: view.instance.name,
		readyForYou: view.ready.map(task),
		needsInformation: view.held.map(task),
		waitingOnOthers: view.waiting.map(waiting),
		recurring: view.recurring.map(task),
		cases: view.cases.map((c) =>
			compact({
				id: c.id,
				title: c.title,
				subject: c.subject,
				openedAt: c.openedAt,
				yourOpenTasks: c.forYou,
				processes: c.processes.map(processLine)
			})
		)
	};
}

function recorded(r: RecordEntry | RecordedValue) {
	return compact({
		fact: r.fact,
		title: r.title,
		value: r.display,
		file: r.file,
		evidence: r.evidence,
		recordedBy: r.by?.name,
		onBehalfOf: 'onBehalfOf' in r ? r.onBehalfOf?.name : undefined,
		at: r.at,
		from: r.from ? `${r.from.title} (${r.from.process})` : undefined,
		sharedBy: r.sharedBy.length ? r.sharedBy : undefined
	});
}

export function caseView(c: CaseView) {
	return compact({
		id: c.id,
		title: c.title,
		subject: c.subject,
		casebook: c.instance.slug,
		openedAt: c.openedAt,
		openedBy: c.openedBy?.name,
		yourTasks: c.mine.map(task),
		processes: c.processes.map((p) =>
			compact({
				...processLine(p),
				latestVersion: p.latestVersion,
				binding: p.binding,
				startedBy: p.startedBy?.name,
				startedAt: p.startedAt,
				stages: p.stages.map((s) => ({ title: s.title, state: s.state })),
				othersAreDoing: p.others,
				items: p.items.map((i) =>
					compact({
						item: i.id,
						kind: i.kind,
						title: i.title,
						status: i.status,
						role: i.role,
						holders: names(i.holders),
						done: i.done ? { by: i.done.by.name, at: i.done.at } : undefined,
						skipped: i.skipped
							? { by: i.skipped.by.name, at: i.skipped.at, reason: i.skipped.reason }
							: undefined,
						paused: note(i.held)
					})
				)
			})
		),
		record: c.record.map(recorded),
		youCanAddAProcess: c.can.addProcess
	});
}

export function taskView(t: TaskView) {
	return compact({
		case: t.case.id ? t.case : { title: t.case.title },
		task: task(t.task),
		guidance: t.content,
		condition: t.guard ? { text: t.guard.text, onThisCase: t.guard.state } : undefined,
		repeats: t.repeat,
		you: {
			canAct: t.you.canAct,
			reason: t.you.reason,
			role: t.you.role,
			othersWhoCan: names(t.you.others)
		},
		uses: t.uses.map((u) =>
			compact({ fact: u.fact, title: u.title, ...(u.recorded ? recorded(u.recorded) : {}) })
		),
		fields: t.fields.map((f) =>
			compact({
				fact: f.fact,
				title: f.title,
				kind: f.kind,
				multiple: f.multiple || undefined,
				hint: f.hint,
				options: f.options,
				people: f.people,
				currency: f.currency,
				example: f.example,
				attach: f.evidence,
				fileSlot: f.kind === 'file' ? `fact:${f.fact}` : undefined,
				current: f.current
			})
		),
		evidence: t.evidence.length ? t.evidence : undefined,
		canSkip: t.canSkip || undefined,
		reviews: t.reviews
			? compact({ title: t.reviews.title, doneBy: t.reviews.doneBy?.name })
			: undefined,
		askedBy: t.requester?.name
	});
}

export function processView(view: ProcessView) {
	const { process: p } = view;
	const run = runnableProcess(p.document);
	const factTitle = (id: string) => run.facts.get(id)?.core.title ?? id;
	const roleTitle = (id: string) => run.roles.get(id)?.title ?? id;
	return compact({
		id: p.id,
		slug: p.slug,
		title: run.title,
		summary: run.summary,
		namespace: p.namespace,
		status: p.status,
		version: p.version,
		changePolicy: p.policy,
		draftChangesPending: p.draftPending || undefined,
		youCanStartACase: p.can.start.allowed,
		startReason: p.can.start.reason,
		roles: [...run.roles.entries()].map(([id, r]) =>
			compact({ id, title: r.title ?? id, scope: r.scope ?? 'namespace' })
		),
		stages: run.stages.map((s) => ({
			id: s.id,
			title: s.title,
			items: run.items
				.filter((i) => i.stage === s.id)
				.map((i) =>
					compact({
						item: i.id,
						kind: i.kind,
						title: i.title,
						role: roleTitle(i.role),
						doneBy: i.kind === 'approval' ? 'a person, never an agent' : DONE_BY[i.actor],
						needs: i.requires.length ? i.requires.map(factTitle) : undefined,
						records: i.collects.length
							? i.collects.map((c) =>
									c.by && c.by !== i.role
										? `${factTitle(c.fact)} (by ${roleTitle(c.by)})`
										: factTitle(c.fact)
								)
							: undefined,
						evidence: i.evidence.length ? i.evidence.map((e) => e.description) : undefined,
						when: i.when?.text,
						repeatsUntil: i.repeat?.until.text,
						reviews: i.reviews,
						guidance: i.content
					})
				)
		})),
		facts: [...run.facts.values()].map((f) =>
			compact({
				id: f.core.id,
				title: f.core.title ?? f.core.id,
				type: typeof f.core.schema.type === 'string' ? f.core.schema.type : undefined,
				format: typeof f.core.schema.format === 'string' ? f.core.schema.format : undefined
			})
		),
		cases: view.cases.map((c) => ({
			id: c.id,
			title: c.title,
			attachmentId: c.attachment.id,
			stage: stageText(c.attachment.line)
		})),
		casesYouCannotOpen: view.hiddenCases || undefined
	});
}
