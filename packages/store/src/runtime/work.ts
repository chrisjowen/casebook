// What the runner screens read: the instances a user belongs to, their work in one, the cases
// and their records, one task's form, a guest's requests, and the processes they can run. Every
// read acts as the signed-in actor and is scoped on the server: members see the cases they can
// open (`case.read`), and a guest sees only the forms addressed to them, with only the values
// those forms use.
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
	awaitingAnswer,
	collectedBy,
	factChoices,
	isFileFact,
	isOpen,
	referencedFile,
	type Choice,
	type DefinitionDocument,
	type FactNode,
	type FactSchema,
	type GuardState,
	type ItemState,
	type ItemStatus,
	type Question,
	type StageState,
	type WorkItemKind
} from '@casebook/model';
import { can, isAccountRole, type AccountRole, type Actor, type Decision } from '../authz.js';
import type { Db, Queryable } from '../client.js';
import { listDefinitions } from '../definitions.js';
import {
	accounts,
	caseAttachments,
	cases,
	definitionVersions,
	namespaces,
	principals,
	processDefinitions,
	roleBindings
} from '../schema.js';
import { displayValue } from './format.js';
import {
	caseIdsInAccount,
	loadCases,
	type FileRecord,
	type Loaded,
	type LoadedAttachment,
	type LoadedCase,
	type Person
} from './load.js';
import { skippable } from './actions.js';

export interface PersonView {
	id: string;
	name: string;
}

/** A casebook the user belongs to: an account where they hold an account role (ADR 0015). */
export interface Instance {
	slug: string;
	name: string;
	role: AccountRole;
	/** Tasks ready for them or paused by them, for the switcher's count. */
	waitingOnYou: number;
}

export interface StageLine {
	/** 1-based, and the number of stages plus one once the process is complete. */
	number: number;
	count: number;
	/** The current stage's title, or "Finished". */
	title: string;
}

export interface Mark {
	by: PersonView;
	at: string;
}

/** A work item as a row in a list. */
export interface TaskSummary {
	caseId: string;
	caseTitle: string;
	attachmentId: string;
	/** The process name, with the attachment's label when it has one. */
	process: string;
	definitionSlug: string;
	item: string;
	kind: WorkItemKind;
	title: string;
	status: ItemStatus;
	stage: StageLine & { index: number };
	role: string;
	holders: PersonView[];
	held?: Mark & { note: string };
	sentBack?: Mark & { note: string };
	/** People who started filling it in, first first. */
	started: Mark[];
	/** For `waiting`: the work that records what it needs, and who does it. */
	waitingOn?: { title: string; holders: PersonView[]; held?: Mark & { note: string } };
	repeating: boolean;
	due?: string;
	overdue?: boolean;
	lastDone?: Mark;
	/** Open questions about it: how many wait on an answer, and how many have one (ADR 0026). */
	questions?: { waiting: number; answered: number };
}

/** A process on a case that the user is waiting on others for. */
export interface WaitingEntry {
	caseId: string;
	caseTitle: string;
	attachmentId: string;
	process: string;
	definitionSlug: string;
	stage: StageLine;
	/** What the others are doing, with any pause and its note: pausing notifies only them. */
	on: { title: string; holders: PersonView[]; held?: Mark & { note: string } }[];
	/**
	 * True when the user has done something in this process and has nothing open in it; false when
	 * their own task waits, or they have not done anything here yet.
	 */
	myPartDone: boolean;
	/** The user's own task that is waiting, if any. */
	mine?: TaskSummary;
}

export interface AttachmentSummary {
	id: string;
	name: string;
	definitionId: string;
	definitionSlug: string;
	namespace: string;
	version: number;
	latestVersion: number;
	binding: 'pinned' | 'follow_latest';
	stages: StageState[];
	line: StageLine;
	complete: boolean;
}

export interface CaseCard {
	id: string;
	title: string;
	subject?: string;
	openedAt: string;
	forYou: number;
	processes: AttachmentSummary[];
}

/** A question someone asked the actor about a task, which waits on their answer. */
export interface AskedEntry {
	caseId: string;
	caseTitle: string;
	attachmentId: string;
	item: string;
	/** The task it is about. */
	title: string;
	process: string;
	definitionSlug: string;
	question: { id: number; text: string; by: PersonView; at: string };
}

export interface WorkView {
	instance: Instance;
	/** Questions others asked the actor, oldest first. */
	asked: AskedEntry[];
	ready: TaskSummary[];
	held: TaskSummary[];
	waiting: WaitingEntry[];
	recurring: TaskSummary[];
	cases: CaseCard[];
}

export type ReadRefusal = { ok: false; code: 'access-denied' | 'not-found'; reason: string };

const notFound = (reason = 'That does not exist, or you cannot see it.'): ReadRefusal => ({
	ok: false,
	code: 'not-found',
	reason
});
const denied = (reason: string): ReadRefusal => ({ ok: false, code: 'access-denied', reason });

const iso = (d: Date) => d.toISOString();

/** The principal whose work this is: an agent's user, or the actor. */
const subjectOf = (actor: Actor) => actor.onBehalfOfId ?? actor.id;

// Instances

/** Accounts where the actor holds an account role, by name, with what waits on them in each. */
export async function listInstances(db: Db, actor: Actor, now = new Date()): Promise<Instance[]> {
	const rows = await db
		.select({
			id: accounts.id,
			slug: accounts.slug,
			name: accounts.displayName,
			role: roleBindings.role
		})
		.from(roleBindings)
		.innerJoin(accounts, eq(accounts.id, roleBindings.accountId))
		.where(
			and(eq(roleBindings.principalId, subjectOf(actor)), sql`${roleBindings.namespaceId} IS NULL`)
		)
		.orderBy(asc(accounts.displayName));
	const result: Instance[] = [];
	for (const row of rows) {
		if (!isAccountRole(row.role) || result.some((r) => r.slug === row.slug)) continue;
		const loaded = await readableCases(db, actor, row.id, now);
		const mine = loaded.cases.flatMap((c) => myStates(c, actor));
		const me = subjectOf(actor);
		const asked = loaded.cases.flatMap((c) =>
			c.attachments.flatMap((a) =>
				a.conversation.questions.filter((q) => q.to === me && awaitingAnswer(q))
			)
		);
		result.push({
			slug: row.slug,
			name: row.name,
			role: row.role,
			waitingOnYou:
				asked.length +
				mine.filter(
					({ state }) => !state.item.repeat && (state.status === 'ready' || state.status === 'held')
				).length
		});
	}
	return result;
}

async function instanceFor(
	db: Db,
	actor: Actor,
	slug: string
): Promise<{ accountId: string; instance: Instance } | ReadRefusal> {
	const [account] = await db
		.select({ id: accounts.id, name: accounts.displayName })
		.from(accounts)
		.where(eq(accounts.slug, slug));
	if (!account) return notFound('There is no such casebook.');
	const [role] = await db
		.select({ role: roleBindings.role })
		.from(roleBindings)
		.where(
			and(
				eq(roleBindings.accountId, account.id),
				eq(roleBindings.principalId, subjectOf(actor)),
				sql`${roleBindings.namespaceId} IS NULL`
			)
		);
	if (!role || !isAccountRole(role.role)) {
		return denied(`You are not a member of ${account.name}.`);
	}
	return {
		accountId: account.id,
		instance: { slug, name: account.name, role: role.role, waitingOnYou: 0 }
	};
}

/** The cases in an account the actor may open. */
async function readableCases(db: Db, actor: Actor, accountId: string, now: Date): Promise<Loaded> {
	const ids = await caseIdsInAccount(db, accountId);
	return loadCases(db, await readableOf(db, actor, ids), now);
}

/**
 * The cases among these the actor may open, in order. For a user acting for themselves
 * `case.read` turns on the case's namespace alone, so it is decided once per namespace; an
 * agent's delegation can be limited to one case, so its access is decided case by case.
 */
async function readableOf(db: Db, actor: Actor, ids: string[]): Promise<string[]> {
	if (ids.length === 0) return [];
	const rows = await db
		.select({ id: cases.id, namespaceId: cases.namespaceId })
		.from(cases)
		.where(inArray(cases.id, ids));
	const [who] = await db
		.select({ kind: principals.kind })
		.from(principals)
		.where(eq(principals.id, actor.id));
	const byNamespace = actor.onBehalfOfId === undefined && who?.kind === 'user';
	const namespaceOf = new Map(rows.map((r) => [r.id, r.namespaceId]));
	const decided = new Map<string, boolean>();
	const readable: string[] = [];
	for (const id of ids) {
		const ns = namespaceOf.get(id);
		if (ns === undefined) continue;
		const key = byNamespace ? ns : id;
		let allowed = decided.get(key);
		if (allowed === undefined) {
			allowed = (await can(db, actor, 'case.read', { type: 'case', caseId: id })).allowed;
			decided.set(key, allowed);
		}
		if (allowed) readable.push(id);
	}
	return readable;
}

// Shaping

function person(people: ReadonlyMap<string, Person>, id: string): PersonView {
	return { id, name: people.get(id)?.name ?? 'Someone' };
}

function attachmentName(a: LoadedAttachment): string {
	return a.label ? `${a.process.title} · ${a.label}` : a.process.title;
}

function stageLine(a: LoadedAttachment): StageLine {
	const { stages, current, complete } = a.state;
	return {
		number: current + 1,
		count: stages.length,
		title: complete ? 'Finished' : (stages[current]?.title ?? '')
	};
}

function summarizeAttachment(a: LoadedAttachment): AttachmentSummary {
	return {
		id: a.id,
		name: attachmentName(a),
		definitionId: a.definitionId,
		definitionSlug: a.definitionSlug,
		namespace: a.namespace,
		version: a.version,
		latestVersion: a.latestVersion,
		binding: a.binding,
		stages: a.state.stages,
		line: stageLine(a),
		complete: a.state.complete
	};
}

const holdersOf = (a: LoadedAttachment, role: string) => a.holders.get(role) ?? [];

function summarizeTask(
	c: LoadedCase,
	a: LoadedAttachment,
	state: ItemState,
	people: ReadonlyMap<string, Person>
): TaskSummary {
	const { item, progress } = state;
	const p = (id: string) => person(people, id);
	const mark = (m: { by: string; at: string }) => ({ by: p(m.by), at: m.at });
	const stage = a.process.stages[state.stageIndex];
	const provider = state.waitingOn
		? a.state.items.find((i) => i.item.id === state.waitingOn)
		: undefined;
	return {
		caseId: c.id,
		caseTitle: c.title,
		attachmentId: a.id,
		process: attachmentName(a),
		definitionSlug: a.definitionSlug,
		item: item.id,
		kind: item.kind,
		title: item.title,
		status: state.status,
		stage: {
			index: state.stageIndex,
			number: state.stageIndex + 1,
			count: a.process.stages.length,
			title: stage?.title ?? ''
		},
		role: a.process.roles.get(item.role)?.title ?? item.role,
		holders: holdersOf(a, item.role).map(p),
		started: progress.started.map(mark),
		repeating: item.repeat !== undefined,
		...(progress.held ? { held: { ...mark(progress.held), note: progress.held.note } } : {}),
		...(progress.sentBack
			? { sentBack: { ...mark(progress.sentBack), note: progress.sentBack.note } }
			: {}),
		...(provider
			? {
					waitingOn: {
						title: provider.item.title,
						holders: holdersOf(a, provider.item.role).map(p),
						...(provider.progress.held
							? {
									held: { ...mark(provider.progress.held), note: provider.progress.held.note }
								}
							: {})
					}
				}
			: {}),
		...(state.due ? { due: state.due, overdue: state.overdue ?? false } : {}),
		...(progress.done ? { lastDone: mark(progress.done) } : {}),
		...questionCount(a, item.id)
	};
}

function questionCount(a: LoadedAttachment, item: string) {
	const open = a.conversation.questions.filter((q) => q.item === item && !q.resolved);
	if (open.length === 0) return {};
	const waiting = open.filter(awaitingAnswer).length;
	return { questions: { waiting, answered: open.length - waiting } };
}

/** The actor's open items in a case: those whose role they hold. */
function myStates(c: LoadedCase, actor: Actor) {
	const me = subjectOf(actor);
	return c.attachments.flatMap((a) =>
		a.state.items
			.filter((s) => isOpen(s.status) && holdersOf(a, s.item.role).includes(me))
			.map((state) => ({ a, state }))
	);
}

/** True when the actor takes part in a process: a role bound on the case, or work done in it. */
function involved(c: LoadedCase, a: LoadedAttachment, me: string, caseRoles: Set<string>) {
	return (
		[...a.process.roles.keys()].some((r) => caseRoles.has(r) && holdersOf(a, r).includes(me)) ||
		a.events.some((e) => e.by === me || e.onBehalfOf === me) ||
		a.startedBy === me
	);
}

async function caseRolesOf(db: Queryable, principalId: string, caseIds: string[]) {
	if (caseIds.length === 0) return new Map<string, Set<string>>();
	const rows = await db
		.select({ caseId: roleBindings.caseId, role: roleBindings.role })
		.from(roleBindings)
		.where(and(eq(roleBindings.principalId, principalId), inArray(roleBindings.caseId, caseIds)));
	const map = new Map<string, Set<string>>();
	for (const r of rows) {
		if (!r.caseId) continue;
		(map.get(r.caseId) ?? map.set(r.caseId, new Set()).get(r.caseId)!).add(r.role);
	}
	return map;
}

// My work

/**
 * Everything waiting on the actor in one instance, in a fixed order: ready for them, paused by
 * them for missing information, what they wait on others for, and repeating work last. Also the
 * cases they can open, each with how many of its tasks are theirs.
 */
export async function loadWork(
	db: Db,
	actor: Actor,
	instanceSlug: string,
	now = new Date()
): Promise<WorkView | ReadRefusal> {
	const found = await instanceFor(db, actor, instanceSlug);
	if ('ok' in found) return found;
	const loaded = await readableCases(db, actor, found.accountId, now);
	const me = subjectOf(actor);
	const caseRoles = await caseRolesOf(
		db,
		me,
		loaded.cases.map((c) => c.id)
	);
	const ready: TaskSummary[] = [];
	const held: TaskSummary[] = [];
	const recurring: TaskSummary[] = [];
	const waiting: WaitingEntry[] = [];
	const asked: AskedEntry[] = [];
	const cards: CaseCard[] = [];

	for (const c of loaded.cases) {
		for (const a of c.attachments) {
			for (const q of a.conversation.questions) {
				if (q.to !== me || !awaitingAnswer(q)) continue;
				asked.push({
					caseId: c.id,
					caseTitle: c.title,
					attachmentId: a.id,
					item: q.item,
					title: a.process.items.find((i) => i.id === q.item)?.title ?? q.item,
					process: attachmentName(a),
					definitionSlug: a.definitionSlug,
					question: { id: q.id, text: q.text, by: person(loaded.people, q.by), at: q.at }
				});
			}
		}
		const mine = myStates(c, actor);
		for (const { a, state } of mine) {
			const task = summarizeTask(c, a, state, loaded.people);
			if (state.item.repeat) recurring.push(task);
			else if (state.status === 'ready') ready.push(task);
			else if (state.status === 'held') held.push(task);
		}
		for (const a of c.attachments) {
			if (a.state.complete) continue;
			const mineHere = mine.filter((m) => m.a.id === a.id && !m.state.item.repeat);
			if (mineHere.some((m) => m.state.status === 'ready' || m.state.status === 'held')) continue;
			const myWaiting = mineHere.find(
				(m) => m.state.status === 'waiting' || m.state.status === 'blocked'
			);
			if (!myWaiting && !involved(c, a, me, caseRoles.get(c.id) ?? new Set())) continue;
			const others = a.state.items.filter(
				(s) =>
					!s.item.repeat &&
					(s.status === 'ready' || s.status === 'held') &&
					!holdersOf(a, s.item.role).includes(me)
			);
			if (others.length === 0 && !myWaiting) continue;
			const p = (id: string) => person(loaded.people, id);
			waiting.push({
				caseId: c.id,
				caseTitle: c.title,
				attachmentId: a.id,
				process: attachmentName(a),
				definitionSlug: a.definitionSlug,
				stage: stageLine(a),
				on: others.map((s) => ({
					title: s.item.title,
					holders: holdersOf(a, s.item.role).map(p),
					...(s.progress.held
						? {
								held: {
									by: p(s.progress.held.by),
									at: s.progress.held.at,
									note: s.progress.held.note
								}
							}
						: {})
				})),
				// Starting the case, or holding a role with nothing done yet, is not a part done.
				myPartDone: !myWaiting && a.events.some((e) => e.by === me || e.onBehalfOf === me),
				...(myWaiting ? { mine: summarizeTask(c, a, myWaiting.state, loaded.people) } : {})
			});
		}
		cards.push(caseCard(c, mine.length));
	}
	const byDue = (x: TaskSummary, y: TaskSummary) => (x.due ?? '').localeCompare(y.due ?? '');
	return {
		instance: found.instance,
		asked: asked.sort((x, y) => x.question.at.localeCompare(y.question.at)),
		ready,
		held,
		waiting,
		recurring: recurring.sort(byDue),
		cases: cards
	};
}

function caseCard(c: LoadedCase, forYou: number): CaseCard {
	return {
		id: c.id,
		title: c.title,
		openedAt: iso(c.createdAt),
		forYou,
		processes: c.attachments.map(summarizeAttachment),
		...(c.subject ? { subject: c.subject } : {})
	};
}

// One case

export interface RecordEntry {
	fact?: string;
	title: string;
	display: string;
	file?: { id: string; name: string; size: number; contentType: string };
	at: string;
	by: PersonView;
	onBehalfOf?: PersonView;
	from?: { attachmentId: string; item: string; title: string; process: string };
	/** The processes on the case that read or record the fact, when more than one does. */
	sharedBy: string[];
	/** For a file backing a fact or meeting a step's evidence requirement: what it is for. */
	evidence?: string;
}

/** A work item as the read-only whole-process view lists it for a case. */
export interface ItemBrief {
	id: string;
	kind: WorkItemKind;
	title: string;
	status: ItemStatus;
	role: string;
	holders: PersonView[];
	done?: Mark;
	skipped?: Mark & { reason: string };
	held?: Mark & { note: string };
}

export interface CaseProcess extends AttachmentSummary {
	/** One plain line about what the others are doing. */
	others: string;
	startedBy?: PersonView;
	startedAt: string;
	items: ItemBrief[];
	document: DefinitionDocument;
}

export interface CaseView {
	instance: Instance;
	id: string;
	title: string;
	subject?: string;
	openedAt: string;
	openedBy?: PersonView;
	mine: TaskSummary[];
	processes: CaseProcess[];
	/** Every captured value and file, files first, newest first within each. */
	record: RecordEntry[];
	/** What the actor may do on the case. */
	can: { addProcess: boolean };
}

/** A case the actor can open, with their tasks on it, its processes and its record. */
export async function loadCase(
	db: Db,
	actor: Actor,
	instanceSlug: string,
	caseId: string,
	now = new Date()
): Promise<CaseView | ReadRefusal> {
	const found = await instanceFor(db, actor, instanceSlug);
	if ('ok' in found) return found;
	if (!/^[0-9a-f-]{36}$/i.test(caseId)) return notFound();
	const read = await can(db, actor, 'case.read', { type: 'case', caseId });
	if (!read.allowed)
		return read.reason.includes('does not exist') ? notFound() : denied(read.reason);
	const {
		cases: [c],
		people
	} = await loadCases(db, [caseId], now);
	if (!c || c.accountId !== found.accountId) return notFound();
	const me = subjectOf(actor);
	const p = (id: string) => person(people, id);
	const mine = myStates(c, actor).map(({ a, state }) => summarizeTask(c, a, state, people));
	const processes = c.attachments.map((a): CaseProcess => ({
		...summarizeAttachment(a),
		others: othersLine(a, me, people),
		startedAt: iso(a.createdAt),
		document: a.document,
		items: a.state.items.map((s) => ({
			id: s.item.id,
			kind: s.item.kind,
			title: s.item.title,
			status: s.status,
			role: a.process.roles.get(s.item.role)?.title ?? s.item.role,
			holders: holdersOf(a, s.item.role).map(p),
			...(s.progress.done ? { done: { by: p(s.progress.done.by), at: s.progress.done.at } } : {}),
			...(s.progress.skipped
				? {
						skipped: {
							by: p(s.progress.skipped.by),
							at: s.progress.skipped.at,
							reason: s.progress.skipped.reason
						}
					}
				: {}),
			...(s.progress.held
				? {
						held: { by: p(s.progress.held.by), at: s.progress.held.at, note: s.progress.held.note }
					}
				: {})
		})),
		...(a.startedBy ? { startedBy: p(a.startedBy) } : {})
	}));
	const addProcess = (await startableIn(db, actor, found.accountId)).length > 0;
	return {
		instance: found.instance,
		id: c.id,
		title: c.title,
		openedAt: iso(c.createdAt),
		mine,
		processes,
		record: caseRecord(c, people),
		can: { addProcess },
		...(c.subject ? { subject: c.subject } : {}),
		...(c.openedBy ? { openedBy: p(c.openedBy) } : {})
	};
}

/** What everyone but `me` is doing in a process, in one plain line. */
function othersLine(a: LoadedAttachment, me: string, people: ReadonlyMap<string, Person>): string {
	if (a.state.complete) return 'Finished.';
	const active = a.state.items.filter(
		(s) => !s.item.repeat && (s.status === 'ready' || s.status === 'held')
	);
	const mine = active.filter((s) => holdersOf(a, s.item.role).includes(me));
	const others = active.filter((s) => !holdersOf(a, s.item.role).includes(me));
	if (others.length === 0) {
		// A question still out is what the case waits on, even with nothing else to do.
		const askedOf = [
			...new Set(a.conversation.questions.filter((q) => awaitingAnswer(q)).map((q) => q.to))
		].filter((id) => id !== me);
		if (askedOf.length)
			return `Waiting on ${names(askedOf.map((id) => person(people, id).name))} to answer a question.`;
		return mine.length ? 'Nobody else has anything to do right now.' : 'Nothing is in progress.';
	}
	const parts = others.map((s) => {
		const who = names(
			holdersOf(a, s.item.role).map((id) => person(people, id).name),
			a.process.roles.get(s.item.role)?.title
		);
		const doing = lowerFirst(s.item.title);
		return s.status === 'held' ? `${who} — ${doing} (paused)` : `${who} — ${doing}`;
	});
	// Only someone who has done something here has a part that is done.
	const acted = a.events.some((e) => e.by === me || e.onBehalfOf === me);
	const lead =
		mine.length > 0
			? 'Also in progress: '
			: acted
				? 'Your part is done for now. Waiting on '
				: 'Waiting on ';
	const line = `${lead}${parts.join('; ')}`;
	// A title such as "Big spend?" already ends the sentence.
	return /[.?!]$/.test(line) ? line : `${line}.`;
}

function names(list: string[], role?: string): string {
	if (list.length === 0) return `nobody yet${role ? ` (${role})` : ''}`;
	if (list.length === 1) return list[0]!;
	return `${list.slice(0, -1).join(', ')} or ${list.at(-1)}`;
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

function factNode(c: LoadedCase, factId: string): FactNode | undefined {
	for (const a of c.attachments) {
		const fact = a.process.facts.get(factId);
		if (fact) return fact;
	}
	return undefined;
}

/** The choices of a fact on the case, from the first attached process that has the fact. */
function choicesOn(c: LoadedCase, factId: string): Choice[] | undefined {
	for (const a of c.attachments) {
		const fact = a.process.facts.get(factId);
		if (fact) return factChoices(a.document, fact.core.schema, a.shared);
	}
	return undefined;
}

function fileView(f: FileRecord) {
	return { id: f.id, name: f.name, size: f.size, contentType: f.contentType };
}

function source(c: LoadedCase, attachmentId: string | undefined, item: string | undefined) {
	const a = c.attachments.find((x) => x.id === attachmentId);
	const work = a?.process.items.find((i) => i.id === item);
	return a && work
		? { from: { attachmentId: a.id, item: work.id, title: work.title, process: attachmentName(a) } }
		: {};
}

/** The processes on a case that read or record a fact, by name, when more than one does. */
function sharedBy(c: LoadedCase, factId: string): string[] {
	const users = c.attachments.filter((a) =>
		a.process.items.some(
			(i) => i.requires.includes(factId as never) || i.collects.some((col) => col.fact === factId)
		)
	);
	return users.length > 1 ? users.map(attachmentName) : [];
}

/**
 * Every value and file on a case, recorded once and shared by its processes (ADR 0001): files
 * first, then values, newest first, each with who recorded it, when, and the task it came from.
 */
function caseRecord(c: LoadedCase, people: ReadonlyMap<string, Person>): RecordEntry[] {
	const p = (id: string) => person(people, id);
	// A file that is a fact's current value is listed once, as that fact.
	const values = new Set([...c.facts.values()].map((f) => referencedFile(f.value)));
	const files = [...c.files]
		.reverse()
		.filter((f) => !values.has(f.id))
		.map((f): RecordEntry => ({
			title: f.name,
			display: f.name,
			file: fileView(f),
			at: iso(f.at),
			by: p(f.by),
			sharedBy: f.fact ? sharedBy(c, f.fact) : [],
			...(f.fact ? { fact: f.fact } : {}),
			...(f.evidence ? { evidence: f.evidence } : {}),
			...(f.onBehalfOf ? { onBehalfOf: p(f.onBehalfOf) } : {}),
			...source(c, f.attachmentId, f.item)
		}));
	const recorded = [...c.facts.values()]
		.sort((x, y) => y.at.getTime() - x.at.getTime())
		.map((f): RecordEntry => {
			const node = factNode(c, f.fact);
			const fileId = referencedFile(f.value);
			const file = c.files.find((x) => x.id === fileId);
			return {
				fact: f.fact,
				title: node?.core.title ?? f.fact,
				display: displayValue(node, f.value, people, c.files, choicesOn(c, f.fact)),
				at: iso(f.at),
				by: p(f.by),
				sharedBy: sharedBy(c, f.fact),
				...(file ? { file: fileView(file) } : {}),
				...(f.onBehalfOf ? { onBehalfOf: p(f.onBehalfOf) } : {}),
				...source(c, f.attachmentId, f.item)
			};
		});
	return [...files, ...recorded];
}

// One task

export type FieldKind =
	| 'text'
	| 'longtext'
	| 'number'
	| 'date'
	| 'datetime'
	| 'yesno'
	| 'choice'
	| 'list'
	| 'file'
	| 'people'
	| 'json';

/** One thing a task form records. */
export interface FormField {
	fact: string;
	title: string;
	kind: FieldKind;
	/** Guidance from the fact's description or content. */
	hint?: string;
	/** For a choice: what can be chosen, each stored as its value and read as its label. */
	options?: { value: string; label: string; code?: string; description?: string }[];
	people?: PersonView[];
	/** Whether more than one value can be given. */
	multiple: boolean;
	currency?: string;
	example?: string;
	/** For a fact that is backed by a document: what to attach. */
	evidence?: { description: string; formats: string[] };
	/** The value already on the case, which a form keeps unless it is changed. */
	current?: { raw: string[]; display: string; file?: { id: string; name: string } };
}

/** A value a task uses, with where it came from. */
/** A recorded value as a form shows it; a guest is not told who recorded it unless it was them. */
export type RecordedValue = Omit<RecordEntry, 'by'> & { by?: PersonView };

export interface UsedValue {
	fact: string;
	title: string;
	recorded?: RecordedValue;
}

export interface TaskView {
	instance?: Instance;
	case: { id: string; title: string };
	process?: AttachmentSummary;
	task: TaskSummary;
	content?: string;
	/** The work item's condition, in the definition's words, and how it reads on this case. */
	guard?: { text: string; state: GuardState };
	repeat?: { text: string; every?: string };
	/** Whether the actor can do it, why not, and who else can. */
	you: { canAct: boolean; reason: string; role: string; others: PersonView[] };
	uses: UsedValue[];
	fields: FormField[];
	/** Documents the step asks for that are not a fact's value. */
	evidence: { slot: string; description: string; formats: string[]; fact?: string }[];
	canSkip: boolean;
	/** For an approval: the step it reviews and who did it. */
	reviews?: { title: string; doneBy?: PersonView };
	/** For a guest: who asked, and one line of context. */
	requester?: PersonView;
	/** The form as someone last saved it, which it reopens with (ADR 0026). */
	draft?: { values: Record<string, string[]>; by: PersonView; at: string };
	/** Questions asked about the task, oldest first, each with its thread. */
	questions: QuestionView[];
	/** Who the actor can ask for information: people who can open the case; none on an approval, which is decided rather than paused. */
	askable: PersonView[];
	/** Every stage of the task's process with its work items, for finding the way around. */
	outline: OutlineStage[];
	/** One plain line about what everyone else is doing in the process. */
	others?: string;
}

export interface QuestionView {
	id: number;
	by: PersonView;
	to: PersonView;
	at: string;
	text: string;
	replies: { by: PersonView; at: string; text: string }[];
	/** It still waits on the person asked. */
	waiting: boolean;
	resolved?: Mark;
	/** The actor can reply or resolve it: they asked, were asked, or can do the task. */
	canReply: boolean;
}

export interface OutlineStage {
	id: string;
	title: string;
	state: StageState['state'];
	items: {
		id: string;
		kind: WorkItemKind;
		title: string;
		status: ItemStatus;
		/** The actor holds its role. */
		mine: boolean;
		holders: PersonView[];
	}[];
}

/** One task's form, for a member who can open its case. */
export async function loadTask(
	db: Db,
	actor: Actor,
	instanceSlug: string,
	ref: { attachmentId: string; item: string },
	{ askable = false, now = new Date() }: { askable?: boolean; now?: Date } = {}
): Promise<TaskView | ReadRefusal> {
	const found = await instanceFor(db, actor, instanceSlug);
	if ('ok' in found) return found;
	const located = await locate(db, ref, now);
	if (!located || located.c.accountId !== found.accountId) return notFound();
	const read = await can(db, actor, 'case.read', { type: 'case', caseId: located.c.id });
	if (!read.allowed) return denied(read.reason);
	const view = await taskView(db, actor, located, located.people, askable);
	return { ...view, instance: found.instance, process: summarizeAttachment(located.a) };
}

async function locate(db: Db, ref: { attachmentId: string; item: string }, now: Date) {
	if (!/^[0-9a-f-]{36}$/i.test(ref.attachmentId)) return undefined;
	const [row] = await db
		.select({ caseId: caseAttachments.caseId })
		.from(caseAttachments)
		.where(eq(caseAttachments.id, ref.attachmentId));
	if (!row) return undefined;
	const {
		cases: [c],
		people
	} = await loadCases(db, [row.caseId], now);
	const a = c?.attachments.find((x) => x.id === ref.attachmentId);
	const state = a?.state.items.find((s) => s.item.id === ref.item);
	return c && a && state ? { c, a, state, people } : undefined;
}

async function taskView(
	db: Db,
	actor: Actor,
	{ c, a, state }: { c: LoadedCase; a: LoadedAttachment; state: ItemState },
	people: ReadonlyMap<string, Person>,
	withAskable = false
): Promise<TaskView> {
	const { item } = state;
	const me = subjectOf(actor);
	const p = (id: string) => person(people, id);
	const record = caseRecord(c, people);
	const recorded = (fact: string) => record.find((r) => r.fact === fact && !r.evidence);
	const decision = await can(db, actor, 'case.act_in_role', {
		type: 'case-role',
		caseId: c.id,
		role: item.role
	});
	const roleTitle = a.process.roles.get(item.role)?.title ?? item.role;
	const fields = await formFields(db, c, a, collectedBy(item), record);
	const reviewed = item.reviews ? a.state.items.find((s) => s.item.id === item.reviews) : undefined;
	const draft =
		decision.allowed && isOpen(state.status) ? a.conversation.drafts[item.id] : undefined;
	const inThread = (q: Question) => q.by === me || q.to === me || decision.allowed;
	return {
		questions: a.conversation.questions
			.filter((q) => q.item === item.id)
			.map((q) => ({
				id: q.id,
				by: p(q.by),
				to: p(q.to),
				at: q.at,
				text: q.text,
				replies: q.replies.map((r) => ({ by: p(r.by), at: r.at, text: r.text })),
				waiting: awaitingAnswer(q),
				canReply: inThread(q),
				...(q.resolved ? { resolved: { by: p(q.resolved.by), at: q.resolved.at } } : {})
			})),
		askable:
			withAskable && decision.allowed && isOpen(state.status) && item.kind !== 'approval'
				? await askablePeople(db, c, me)
				: [],
		outline: outline(a, me, people),
		others: othersLine(a, me, people),
		...(draft ? { draft: { values: draft.values, by: p(draft.by), at: draft.at } } : {}),
		case: { id: c.id, title: c.title },
		task: summarizeTask(c, a, state, people),
		you: {
			canAct: decision.allowed,
			reason: decision.reason,
			role: roleTitle,
			others: holdersOf(a, item.role)
				.filter((id) => id !== me)
				.map(p)
		},
		uses: item.requires.map((fact) => {
			const r = recorded(fact);
			return {
				fact,
				title: a.process.facts.get(fact)?.core.title ?? fact,
				...(r ? { recorded: r } : {})
			};
		}),
		fields,
		evidence: item.evidence
			.map((e, i) => ({ e, i }))
			.filter(({ e }) => {
				const fact = e.fact ? a.process.facts.get(e.fact) : undefined;
				return !fact || !isFileFact(fact.core.schema);
			})
			.map(({ e, i }) => ({
				slot: `evidence:${i}`,
				description: e.description,
				formats: e.formats ?? [],
				...(e.fact ? { fact: e.fact } : {})
			})),
		canSkip: skippable(state) && isOpen(state.status),
		...(item.content ? { content: item.content } : {}),
		...(item.when ? { guard: { text: item.when.text, state: state.guard } } : {}),
		...(item.repeat
			? {
					repeat: {
						text: item.repeat.until.text,
						...(item.repeat.every ? { every: item.repeat.every } : {})
					}
				}
			: {}),
		...(reviewed
			? {
					reviews: {
						title: reviewed.item.title,
						...(reviewed.progress.done ? { doneBy: p(reviewed.progress.done.by) } : {})
					}
				}
			: {})
	};
}

/** Everyone in the case's account who can open it, but the actor, by name. */
async function askablePeople(db: Db, c: LoadedCase, me: string): Promise<PersonView[]> {
	const rows = await db
		.selectDistinct({ id: principals.id, name: principals.displayName })
		.from(roleBindings)
		.innerJoin(principals, eq(principals.id, roleBindings.principalId))
		.where(and(eq(roleBindings.accountId, c.accountId), eq(principals.kind, 'user')))
		.orderBy(asc(principals.displayName));
	const others = rows.filter((row) => row.id !== me);
	const reads = await Promise.all(
		others.map((row) => can(db, { id: row.id }, 'case.read', { type: 'case', caseId: c.id }))
	);
	return others.filter((_, i) => reads[i]!.allowed);
}

/** A process's stages with their work items, each marked when the actor holds its role. */
function outline(
	a: LoadedAttachment,
	me: string,
	people: ReadonlyMap<string, Person>
): OutlineStage[] {
	return a.state.stages.map((stage, index) => ({
		id: stage.id,
		title: stage.title,
		state: stage.state,
		items: a.state.items
			.filter((s) => s.stageIndex === index)
			.map((s) => ({
				id: s.item.id,
				kind: s.item.kind,
				title: s.item.title,
				status: s.status,
				mine: holdersOf(a, s.item.role).includes(me),
				holders: holdersOf(a, s.item.role).map((id) => person(people, id))
			}))
	}));
}

function fieldKind(
	schema: FactSchema,
	choices: readonly Choice[] | undefined,
	current: unknown
): Pick<FormField, 'kind' | 'multiple' | 'options'> {
	if (isFileFact(schema)) return { kind: 'file', multiple: false };
	if (schema['x-lookup']?.kind === 'principal') {
		return { kind: 'people', multiple: schema.type === 'array' };
	}
	if (choices) {
		// a turned-off value is offered only to keep what the case already holds
		const held = new Set((Array.isArray(current) ? current : [current]).map(String));
		return {
			kind: 'choice',
			multiple: schema.type === 'array',
			options: choices
				.filter((c) => !c.disabled || held.has(c.value))
				.map((c) => ({
					value: c.value,
					label: c.label,
					...(c.code ? { code: c.code } : {}),
					...(c.description ? { description: c.description } : {})
				}))
		};
	}
	switch (schema.type) {
		case 'boolean':
			return { kind: 'yesno', multiple: false };
		case 'number':
		case 'integer':
			return { kind: 'number', multiple: false };
		case 'array':
			return { kind: 'list', multiple: true };
		case 'object':
			return { kind: 'json', multiple: false };
	}
	if (schema.format === 'date') return { kind: 'date', multiple: false };
	if (schema.format === 'date-time') return { kind: 'datetime', multiple: false };
	return { kind: 'text', multiple: false };
}

async function formFields(
	db: Db,
	c: LoadedCase,
	a: LoadedAttachment,
	facts: string[],
	record: RecordEntry[]
): Promise<FormField[]> {
	const fields: FormField[] = [];
	for (const factId of facts) {
		const fact = a.process.facts.get(factId);
		if (!fact) continue;
		const { schema } = fact.core;
		const existing = c.facts.get(factId);
		const shape = fieldKind(schema, factChoices(a.document, schema, a.shared), existing?.value);
		const entry = record.find((r) => r.fact === factId && !r.evidence);
		const evidence = schema['x-evidence'];
		const hint = typeof schema.description === 'string' ? schema.description : fact.content;
		const example = Array.isArray(schema.examples) ? schema.examples[0] : undefined;
		fields.push({
			fact: factId,
			title: fact.core.title ?? factId,
			...shape,
			...(hint ? { hint } : {}),
			...(typeof schema['x-currency'] === 'string' ? { currency: schema['x-currency'] } : {}),
			...(example !== undefined && shape.kind !== 'file'
				? { example: Array.isArray(example) ? example.join(', ') : String(example) }
				: {}),
			...(evidence && shape.kind !== 'file'
				? { evidence: { description: evidence.description, formats: evidence.formats ?? [] } }
				: {}),
			...(shape.kind === 'people'
				? { people: await accountPeople(db, c.accountId, schema, a) }
				: {}),
			...(existing
				? {
						current: {
							raw: rawValue(existing.value),
							display: entry?.display ?? '',
							...(entry?.file ? { file: { id: entry.file.id, name: entry.file.name } } : {})
						}
					}
				: {})
		});
	}
	return fields;
}

function rawValue(value: unknown): string[] {
	if (Array.isArray(value))
		return value.map((v) => (typeof v === 'string' ? v : JSON.stringify(v)));
	if (typeof value === 'boolean') return [value ? 'yes' : 'no'];
	if (typeof value === 'string') return [value];
	return [JSON.stringify(value)];
}

/**
 * The people a principal fact can name: holders of its lookup role on the case, or everyone who
 * holds a role in the account, guests included, by name.
 */
async function accountPeople(
	db: Db,
	accountId: string,
	schema: FactSchema,
	a: LoadedAttachment
): Promise<PersonView[]> {
	const lookup = schema['x-lookup'];
	const rows = await db
		.selectDistinct({ id: principals.id, name: principals.displayName })
		.from(roleBindings)
		.innerJoin(principals, eq(principals.id, roleBindings.principalId))
		.where(and(eq(roleBindings.accountId, accountId), eq(principals.kind, 'user')))
		.orderBy(asc(principals.displayName));
	if (lookup?.kind === 'principal' && lookup.role) {
		const holders = new Set(holdersOf(a, lookup.role));
		const narrowed = rows.filter((r) => holders.has(r.id));
		if (narrowed.length) return narrowed;
	}
	return rows;
}

/**
 * The people a member can name on a case in this instance: everyone who holds a role in its
 * account, members and guests, by name.
 */
export async function casebookPeople(
	db: Db,
	actor: Actor,
	instanceSlug: string
): Promise<PersonView[] | ReadRefusal> {
	const found = await instanceFor(db, actor, instanceSlug);
	if ('ok' in found) return found;
	return db
		.selectDistinct({ id: principals.id, name: principals.displayName })
		.from(roleBindings)
		.innerJoin(principals, eq(principals.id, roleBindings.principalId))
		.where(and(eq(roleBindings.accountId, found.accountId), eq(principals.kind, 'user')))
		.orderBy(asc(principals.displayName));
}

// Guests

/** A form addressed to a guest: one line of context and who asked. */
export interface GuestRequest {
	attachmentId: string;
	item: string;
	title: string;
	status: ItemStatus;
	/** Who asked: whoever started the process, or opened the case. */
	requester: string;
	/** What it is for: the case's name. */
	forWhom: string;
	/** The casebook that asked. */
	from: string;
}

/**
 * Accounts where the actor holds a role but is not a member: there they are a guest, who sees
 * only the forms addressed to them.
 */
async function guestAccounts(db: Db, actor: Actor): Promise<string[]> {
	const rows = await db
		.select({
			accountId: roleBindings.accountId,
			role: roleBindings.role,
			namespaceId: roleBindings.namespaceId
		})
		.from(roleBindings)
		.where(eq(roleBindings.principalId, subjectOf(actor)));
	const member = new Set(
		rows.filter((r) => r.namespaceId === null && isAccountRole(r.role)).map((r) => r.accountId)
	);
	return [...new Set(rows.map((r) => r.accountId))].filter((id) => !member.has(id));
}

async function guestCases(db: Db, actor: Actor, now: Date): Promise<Loaded> {
	const accountIds = await guestAccounts(db, actor);
	const ids = (await Promise.all(accountIds.map((id) => caseIdsInAccount(db, id)))).flat();
	return loadCases(db, ids, now);
}

/** Every form waiting on a guest, across the casebooks that asked; done ones last. */
export async function loadRequests(
	db: Db,
	actor: Actor,
	now = new Date()
): Promise<GuestRequest[]> {
	const loaded = await guestCases(db, actor, now);
	const me = subjectOf(actor);
	const requests: GuestRequest[] = [];
	for (const c of loaded.cases) {
		for (const a of c.attachments) {
			for (const s of a.state.items) {
				if (!holdersOf(a, s.item.role).includes(me)) continue;
				if (s.status === 'upcoming' || s.status === 'skipped') continue;
				requests.push({
					attachmentId: a.id,
					item: s.item.id,
					title: s.item.title,
					status: s.status,
					requester: person(loaded.people, a.startedBy ?? c.openedBy ?? '').name,
					forWhom: c.title,
					from: c.accountName
				});
			}
		}
	}
	return requests.sort((x, y) => Number(x.status === 'done') - Number(y.status === 'done'));
}

/** True when the actor is a guest of the case's account and holds the item's role there. */
async function guestHolds(
	db: Db,
	actor: Actor,
	located: { c: LoadedCase; a: LoadedAttachment; state: ItemState }
) {
	const accounts = await guestAccounts(db, actor);
	return (
		accounts.includes(located.c.accountId) &&
		holdersOf(located.a, located.state.item.role).includes(subjectOf(actor))
	);
}

/**
 * A guest's form: only the values it uses and records, one line of context and who asked.
 * Nothing else about the case leaves the server.
 */
export async function loadGuestTask(
	db: Db,
	actor: Actor,
	ref: { attachmentId: string; item: string },
	now = new Date()
): Promise<TaskView | ReadRefusal> {
	const located = await locate(db, ref, now);
	if (!located || !(await guestHolds(db, actor, located))) return notFound();
	const { c, a, state, people } = located;
	const view = await taskView(db, actor, located, people);
	const keep = new Set<string>([...state.item.requires, ...state.item.collects.map((x) => x.fact)]);
	const requester = a.startedBy ?? c.openedBy;
	const me = subjectOf(actor);
	const t = view.task;
	const scrub = (r: RecordedValue): RecordedValue => ({
		title: r.title,
		display: r.display,
		at: r.at,
		...(r.by?.id === me ? { by: r.by } : {}),
		sharedBy: [],
		...(r.fact ? { fact: r.fact } : {}),
		...(r.file ? { file: r.file } : {})
	});
	return {
		case: { id: '', title: c.title },
		task: {
			caseId: '',
			caseTitle: '',
			attachmentId: t.attachmentId,
			process: '',
			definitionSlug: '',
			item: t.item,
			kind: t.kind,
			title: t.title,
			status: t.status,
			stage: { index: 0, number: 0, count: 0, title: '' },
			role: '',
			holders: t.holders.filter((h) => h.id === me),
			...(t.held?.by.id === me ? { held: t.held } : {}),
			...(t.sentBack?.by.id === me ? { sentBack: t.sentBack } : {}),
			started: t.started.filter((s) => s.by.id === me),
			repeating: t.repeating,
			...(t.due ? { due: t.due } : {}),
			...(t.overdue !== undefined ? { overdue: t.overdue } : {}),
			...(t.lastDone?.by.id === me ? { lastDone: t.lastDone } : {})
		},
		you: {
			canAct: view.you.canAct,
			reason: view.you.canAct ? 'This form was sent to you.' : '',
			role: view.you.role,
			others: []
		},
		uses: view.uses
			.filter((u) => keep.has(u.fact))
			.map((u) => ({
				fact: u.fact,
				title: u.title,
				...(u.recorded ? { recorded: scrub(u.recorded) } : {})
			})),
		fields: view.fields.map(({ people: list, current, ...f }) => ({
			...f,
			...(list ? { people: list.filter((x) => x.id === me) } : {}),
			...(current && (!list || current.raw.every((id) => id === me)) ? { current } : {})
		})),
		evidence: view.evidence,
		canSkip: false,
		questions: [],
		askable: [],
		outline: [],
		...(view.draft?.by.id === me ? { draft: view.draft } : {}),
		...(view.content ? { content: view.content } : {}),
		...(requester ? { requester: person(people, requester) } : {})
	};
}

/**
 * The file with this id, for an actor who can open its case, or a guest whose form uses or
 * records the fact it belongs to. Returns where its bytes are stored.
 */
export async function findCaseFile(
	db: Db,
	actor: Actor,
	fileId: string,
	now = new Date()
): Promise<{ name: string; contentType: string; storageKey: string } | ReadRefusal> {
	if (!/^[0-9a-f-]{36}$/i.test(fileId)) return notFound();
	const [row] = await db.execute<{ case_id: string }>(
		sql`SELECT case_id FROM case_files WHERE id = ${fileId}`
	);
	if (!row) return notFound();
	const {
		cases: [c]
	} = await loadCases(db, [row.case_id], now);
	const file = c?.files.find((f) => f.id === fileId);
	if (!c || !file) return notFound();
	const read = await can(db, actor, 'case.read', { type: 'case', caseId: c.id });
	let allowed = read.allowed;
	if (!allowed && file.fact && (await guestAccounts(db, actor)).includes(c.accountId)) {
		const me = subjectOf(actor);
		allowed = c.attachments.some((a) =>
			a.state.items.some(
				(s) =>
					holdersOf(a, s.item.role).includes(me) &&
					(s.item.requires.includes(file.fact as never) ||
						s.item.collects.some((x) => x.fact === file.fact))
			)
		);
	}
	if (!allowed) return notFound();
	return { name: file.name, contentType: file.contentType, storageKey: file.storageKey };
}

// Processes

export interface ProcessRow {
	id: string;
	slug: string;
	title: string;
	namespace: string;
	status: 'published' | 'draft';
	version?: number;
	policy: 'governed' | 'living';
	requiresApproval: boolean;
	/** The draft changes something since the latest published version. */
	draftPending: boolean;
	/** Cases running it that are not finished, including ones the actor cannot open. */
	liveCases: number;
	updatedAt: string;
	updatedBy: string;
	can: { edit: Decision; start: Decision };
	/** The document to show: the published version, else the draft. */
	document: DefinitionDocument;
}

export interface ProcessGroup {
	namespace: string;
	definitions: ProcessRow[];
	canCreate: Decision;
}

export interface ProcessesView {
	instance: Instance;
	groups: ProcessGroup[];
}

/** The definitions in an instance's namespaces the actor can read, with what they may do. */
export async function listProcesses(
	db: Db,
	actor: Actor,
	instanceSlug: string
): Promise<ProcessesView | ReadRefusal> {
	const found = await instanceFor(db, actor, instanceSlug);
	if ('ok' in found) return found;
	const readable = (await listDefinitions(db, actor)).filter(
		(n) => n.namespace.accountSlug === instanceSlug
	);
	const ids = readable.flatMap((n) => n.definitions.map((d) => d.id));
	const live = ids.length
		? await db
				.select({
					definitionId: definitionVersions.definitionId,
					count: sql<number>`count(*)::int`
				})
				.from(caseAttachments)
				.innerJoin(
					definitionVersions,
					eq(definitionVersions.id, caseAttachments.definitionVersionId)
				)
				.where(
					and(
						inArray(definitionVersions.definitionId, ids),
						sql`${caseAttachments.completedAt} IS NULL`
					)
				)
				.groupBy(definitionVersions.definitionId)
		: [];
	const groups: ProcessGroup[] = [];
	for (const n of readable) {
		const definitions: ProcessRow[] = [];
		for (const d of n.definitions) {
			const document = (d.published ?? d.draft)?.document;
			if (!document) continue;
			const title = document.nodes.find((x) => x.core.kind === 'process')?.core.title ?? d.slug;
			const changed = d.draft && (!d.published || d.changes.length > 0);
			definitions.push({
				id: d.id,
				slug: d.slug,
				title,
				namespace: n.namespace.path,
				status: d.published ? 'published' : 'draft',
				policy: d.changePolicy,
				requiresApproval: d.publishRequiresApproval,
				draftPending: Boolean(d.published && changed),
				liveCases: live.find((l) => l.definitionId === d.id)?.count ?? 0,
				updatedAt: iso(
					d.draft && (!d.published || d.draft.createdAt > d.published.publishedAt)
						? d.draft.createdAt
						: d.published!.publishedAt
				),
				updatedBy:
					d.draft && (!d.published || d.draft.createdAt > d.published.publishedAt)
						? d.draft.authorName
						: d.published!.publishedByName,
				can: {
					edit: d.can.edit,
					start: d.published
						? await can(db, actor, 'case.start', { type: 'definition', definitionId: d.id })
						: { allowed: false, reason: 'Publish it first: cases only run published versions.' }
				},
				document,
				...(d.published ? { version: d.published.version } : {})
			});
		}
		groups.push({ namespace: n.namespace.path, definitions, canCreate: n.can.create });
	}
	return { instance: found.instance, groups };
}

/** Published definitions in an account the actor may start a case of. */
export async function startableIn(db: Db, actor: Actor, accountId: string) {
	const rows = await db
		.selectDistinct({ id: processDefinitions.id })
		.from(processDefinitions)
		.innerJoin(definitionVersions, eq(definitionVersions.definitionId, processDefinitions.id))
		.innerJoin(namespaces, eq(namespaces.id, processDefinitions.namespaceId))
		.where(and(eq(definitionVersions.status, 'published'), eq(namespaces.accountId, accountId)));
	const allowed: string[] = [];
	for (const r of rows) {
		if ((await can(db, actor, 'case.start', { type: 'definition', definitionId: r.id })).allowed) {
			allowed.push(r.id);
		}
	}
	return allowed;
}

/** One process, with the cases running it: those the actor can open, and a count of the rest. */
export interface ProcessView {
	instance: Instance;
	process: ProcessRow;
	cases: { id: string; title: string; attachment: AttachmentSummary }[];
	hiddenCases: number;
}

export async function loadProcess(
	db: Db,
	actor: Actor,
	instanceSlug: string,
	slugOrId: string,
	now = new Date()
): Promise<ProcessView | ReadRefusal> {
	const found = await casesRunning(db, actor, instanceSlug, slugOrId, now);
	if ('ok' in found) return found;
	const { instance, process, loaded, hiddenCases } = found;
	return {
		instance,
		process,
		cases: loaded.flatMap((c) =>
			c.attachments
				.filter((a) => a.definitionId === process.id)
				.map((a) => ({ id: c.id, title: c.title, attachment: summarizeAttachment(a) }))
		),
		hiddenCases
	};
}

/** A case running a process, with the current value of each fact on it. */
export interface CaseFacts {
	id: string;
	title: string;
	facts: Record<string, unknown>;
}

/**
 * The readable cases running a process, newest first, with their facts, so its editor can test
 * conditions against real values.
 */
export async function loadCaseFacts(
	db: Db,
	actor: Actor,
	instanceSlug: string,
	slugOrId: string,
	now = new Date()
): Promise<{ ok: true; cases: CaseFacts[] } | ReadRefusal> {
	const found = await casesRunning(db, actor, instanceSlug, slugOrId, now);
	if ('ok' in found) return found;
	return {
		ok: true,
		cases: found.loaded.map((c) => ({
			id: c.id,
			title: c.title,
			facts: Object.fromEntries([...c.facts].map(([fact, record]) => [fact, record.value]))
		}))
	};
}

async function casesRunning(
	db: Db,
	actor: Actor,
	instanceSlug: string,
	slugOrId: string,
	now: Date
) {
	const list = await listProcesses(db, actor, instanceSlug);
	if ('ok' in list) return list;
	const process = list.groups
		.flatMap((g) => g.definitions)
		.find((d) => d.slug === slugOrId || d.id === slugOrId);
	if (!process) return notFound('There is no such process here, or you cannot read it.');
	const attachmentRows = await db
		.select({ caseId: caseAttachments.caseId })
		.from(caseAttachments)
		.innerJoin(definitionVersions, eq(definitionVersions.id, caseAttachments.definitionVersionId))
		.where(eq(definitionVersions.definitionId, process.id));
	const caseIds = [...new Set(attachmentRows.map((r) => r.caseId))];
	const readable = await readableOf(db, actor, caseIds);
	const { cases: loaded } = await loadCases(db, readable, now);
	return {
		instance: list.instance,
		process,
		loaded,
		hiddenCases: caseIds.length - readable.length
	};
}
