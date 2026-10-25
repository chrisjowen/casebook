// Writes of the case runtime: starting a case, and doing, pausing, resuming, skipping and
// approving its work items. Each write runs in one transaction that locks the case, re-reads it,
// checks the actor with `can` (ADR 0017) and records events naming who acted and for whom
// (ADR 0009). Expected refusals come back as a `RuntimeRefusal` with a plain-language reason.
import { and, desc, eq } from 'drizzle-orm';
import {
	collectedBy,
	factValueProblem,
	fileReference,
	isFileFact,
	readFactInput,
	workApprovalProblem,
	type FactNode,
	type ItemState,
	type LifecycleEvent
} from '@casebook/model';
import { can, type Action, type Actor, type Resource } from '../authz.js';
import type { Db, Tx } from '../client.js';
import type { FileStore } from '../files.js';
import {
	AccessDeniedError,
	insertAttachment,
	insertCase,
	moveAttachmentVersion,
	StoreRuleError,
	type CaseBinding,
	type PrincipalKind
} from '../repository.js';
import {
	caseAttachments,
	caseEvents,
	caseFacts,
	caseFiles,
	cases,
	definitionVersions,
	namespaces,
	principals,
	processDefinitions,
	roleBindings
} from '../schema.js';
import { loadCases, type LoadedAttachment, type LoadedCase } from './load.js';

export const RUNTIME_REFUSAL_CODES = [
	'access-denied',
	'not-found',
	'not-published',
	'not-ready',
	'already-done',
	'invalid-input',
	'human-only'
] as const;

export type RuntimeRefusalCode = (typeof RUNTIME_REFUSAL_CODES)[number];

/** A problem with one field of a submitted form, keyed by fact id or evidence slot. */
export interface FieldProblem {
	field: string;
	message: string;
}

/** Why a runtime write was not done. Nothing was written. */
export interface RuntimeRefusal {
	ok: false;
	code: RuntimeRefusalCode;
	reason: string;
	problems: FieldProblem[];
}

export interface RuntimeOptions {
	/** When the write happens; defaults to now. The demo seed backdates its history with it. */
	now?: Date;
}

const refuse = (
	code: RuntimeRefusalCode,
	reason: string,
	problems: FieldProblem[] = []
): RuntimeRefusal => ({ ok: false, code, reason, problems });

/** Thrown inside a transaction to roll it back and return the refusal. */
class Refused extends Error {
	constructor(readonly refusal: RuntimeRefusal) {
		super(refusal.reason);
	}
}

async function attempt<T>(work: () => Promise<T>): Promise<T | RuntimeRefusal> {
	try {
		return await work();
	} catch (error) {
		if (error instanceof Refused) return error.refusal;
		if (error instanceof StoreRuleError) return refuse('invalid-input', error.message);
		throw error;
	}
}

async function check(tx: Tx, actor: Actor, action: Action, resource: Resource, now: Date) {
	const decision = await can(tx, actor, action, resource, { now });
	if (!decision.allowed) throw new Refused(refuse('access-denied', decision.reason));
}

interface Acting {
	actor: Actor;
	kind: PrincipalKind;
	onBehalfOfKind?: PrincipalKind;
	at: Date;
}

async function acting(tx: Tx, actor: Actor, at: Date): Promise<Acting> {
	const kindOf = async (id: string) => {
		const [row] = await tx
			.select({ kind: principals.kind })
			.from(principals)
			.where(eq(principals.id, id));
		if (!row) throw new Refused(refuse('access-denied', `principal ${id} does not exist`));
		return row.kind;
	};
	const kind = await kindOf(actor.id);
	const forId = actor.onBehalfOfId !== undefined && actor.onBehalfOfId !== actor.id;
	return {
		actor: forId ? actor : { id: actor.id },
		kind,
		...(forId ? { onBehalfOfKind: await kindOf(actor.onBehalfOfId!) } : {}),
		at
	};
}

interface NewEvent {
	caseId: string;
	attachmentId?: string;
	item?: string;
	type: LifecycleEvent;
	data?: Record<string, unknown>;
}

async function record(tx: Tx, who: Acting, event: NewEvent): Promise<string> {
	const [row] = await tx
		.insert(caseEvents)
		.values({
			caseId: event.caseId,
			attachmentId: event.attachmentId ?? null,
			item: event.item ?? null,
			type: event.type,
			actorId: who.actor.id,
			actorKind: who.kind,
			onBehalfOfId: who.actor.onBehalfOfId ?? null,
			onBehalfOfKind: who.onBehalfOfKind ?? null,
			data: event.data ?? {},
			at: who.at
		})
		.returning({ id: caseEvents.id });
	return row!.id;
}

/**
 * After a write, records the stage changes it caused in every process on the case, and marks a
 * process complete, or no longer complete, as its last stage closes or reopens.
 */
async function recordProgress(tx: Tx, who: Acting, before: LoadedCase) {
	const { cases: after } = await loadCases(tx, [before.id], who.at);
	for (const a of after[0]?.attachments ?? []) {
		const old = before.attachments.find((b) => b.id === a.id);
		const base = { caseId: a.caseId, attachmentId: a.id };
		const was = old?.state.current;
		const now = a.state.current;
		if (was !== undefined && now !== was) {
			for (let i = was; i < now; i++) {
				await record(tx, who, {
					...base,
					type: 'stage.completed',
					data: { stage: a.state.stages[i]!.id }
				});
			}
			if (now < a.state.stages.length) {
				await record(tx, who, {
					...base,
					type: 'stage.entered',
					data: { stage: a.state.stages[now]!.id }
				});
			}
		}
		if (a.state.complete !== (old?.state.complete ?? false)) {
			if (a.state.complete) await record(tx, who, { ...base, type: 'process.completed' });
			await tx
				.update(caseAttachments)
				.set({ completedAt: a.state.complete ? who.at : null })
				.where(eq(caseAttachments.id, a.id));
		}
	}
}

// Starting a case

export interface StartCase {
	definitionId: string;
	/** Attach the process to this existing case instead of opening a new one (ADR 0001). */
	caseId?: string;
	/** The new case's title; needed unless `caseId` is given. */
	title?: string;
	subject?: string;
	/** Tells two runs of the same process on one case apart, such as "Delivery bill". */
	label?: string;
	binding?: CaseBinding;
	/**
	 * Who fills each case-scoped role, by role id. Without it, the starter takes the case-scoped
	 * role of the process's first work item.
	 */
	roles?: Record<string, string[]>;
}

export interface Started {
	ok: true;
	caseId: string;
	attachmentId: string;
}

/**
 * Starts a published process on a case: a new case in the definition's namespace, or an existing
 * case the starter can open. It runs the latest published version, pinned for a governed
 * definition and following for a living one unless `binding` says otherwise (ADR 0016).
 *
 * The starter needs write on the definition's namespace, or a role in the process (`case.start`).
 * People named for case roles must already belong to the account or hold a role in it.
 */
export async function startCase(
	db: Db,
	actor: Actor,
	input: StartCase,
	options: RuntimeOptions = {}
): Promise<Started | RuntimeRefusal> {
	const now = options.now ?? new Date();
	return attempt(() =>
		db.transaction(async (tx) => {
			const [definition] = await tx
				.select({
					namespaceId: processDefinitions.namespaceId,
					accountId: namespaces.accountId,
					slug: processDefinitions.slug
				})
				.from(processDefinitions)
				.innerJoin(namespaces, eq(namespaces.id, processDefinitions.namespaceId))
				.where(eq(processDefinitions.id, input.definitionId));
			if (!definition) throw new Refused(refuse('not-found', 'That process does not exist.'));
			const [latest] = await tx
				.select({ id: definitionVersions.id, body: definitionVersions.body })
				.from(definitionVersions)
				.where(
					and(
						eq(definitionVersions.definitionId, input.definitionId),
						eq(definitionVersions.status, 'published')
					)
				)
				.orderBy(desc(definitionVersions.version))
				.limit(1);
			if (!latest) {
				throw new Refused(
					refuse('not-published', 'Publish it first: cases only run published versions.')
				);
			}
			await check(
				tx,
				actor,
				'case.start',
				{ type: 'definition', definitionId: input.definitionId },
				now
			);
			const who = await acting(tx, actor, now);

			let caseId = input.caseId;
			let opened = false;
			if (caseId === undefined) {
				const title = input.title?.trim();
				if (!title) {
					throw new Refused(
						refuse('invalid-input', 'Give the case a name.', [
							{ field: 'title', message: 'Give the case a name' }
						])
					);
				}
				const created = await insertCase(tx, {
					namespaceId: definition.namespaceId,
					title,
					...(input.subject?.trim() ? { subject: input.subject.trim() } : {}),
					openedById: actor.onBehalfOfId ?? actor.id,
					at: now
				});
				caseId = created.id;
				opened = true;
			} else {
				await check(tx, actor, 'case.read', { type: 'case', caseId }, now);
				await tx.select({ id: cases.id }).from(cases).where(eq(cases.id, caseId)).for('update');
			}
			const attachment = await insertAttachment(tx, {
				caseId,
				definitionVersionId: latest.id,
				startedById: actor.onBehalfOfId ?? actor.id,
				at: now,
				...(input.binding ? { binding: input.binding } : {}),
				...(input.label?.trim() ? { label: input.label.trim() } : {})
			});
			if (opened) await record(tx, who, { caseId, type: 'case.opened' });
			await record(tx, who, {
				caseId,
				attachmentId: attachment.id,
				type: 'process.started',
				data: { definition: definition.slug }
			});

			const {
				cases: [loaded]
			} = await loadCases(tx, [caseId], now);
			const a = loaded!.attachments.find((x) => x.id === attachment.id)!;
			const roles = input.roles ?? defaultRoles(a, actor.onBehalfOfId ?? actor.id);
			await assignRoles(tx, who, loaded!, a, roles);
			const first = a.state.stages[0];
			if (first) {
				await record(tx, who, {
					caseId,
					attachmentId: a.id,
					type: 'stage.entered',
					data: { stage: first.id }
				});
			}
			return { ok: true as const, caseId, attachmentId: attachment.id };
		})
	);
}

/** The starter takes the case-scoped role of the process's first work item. */
function defaultRoles(a: LoadedAttachment, starter: string): Record<string, string[]> {
	const first = a.process.items[0];
	if (!first || a.process.roles.get(first.role)?.scope !== 'case') return {};
	return { [first.role]: [starter] };
}

/** Binds people to case-scoped roles, refusing roles the process lacks and people from outside. */
async function assignRoles(
	tx: Tx,
	who: Acting,
	c: LoadedCase,
	a: LoadedAttachment,
	roles: Record<string, string[]>
) {
	const problems: FieldProblem[] = [];
	for (const [role, ids] of Object.entries(roles)) {
		const declared = a.process.roles.get(role);
		if (!declared) {
			problems.push({ field: `role:${role}`, message: `${role} is not a role in this process` });
			continue;
		}
		for (const id of new Set(ids)) {
			if (!(await knownInAccount(tx, c.accountId, id))) {
				problems.push({
					field: `role:${role}`,
					message: `${declared.title ?? role}: choose someone who belongs to this casebook`
				});
				continue;
			}
			if (a.holders.get(role)?.includes(id)) continue;
			await bindCaseRole(tx, who, c, a, role, id);
		}
	}
	if (problems.length) {
		throw new Refused(refuse('invalid-input', problems.map((p) => p.message).join('; '), problems));
	}
}

async function bindCaseRole(
	tx: Tx,
	who: Acting,
	c: LoadedCase,
	a: LoadedAttachment,
	role: string,
	principalId: string
) {
	const inserted = await tx
		.insert(roleBindings)
		.values({ principalId, role, accountId: c.accountId, namespaceId: c.namespaceId, caseId: c.id })
		.onConflictDoNothing()
		.returning({ id: roleBindings.id });
	if (inserted.length) {
		await record(tx, who, {
			caseId: c.id,
			attachmentId: a.id,
			type: 'role.assigned',
			data: { role, principal: principalId }
		});
	}
}

/** True when the principal holds any role in the account: a member, or a guest on some case. */
async function knownInAccount(tx: Tx, accountId: string, principalId: string): Promise<boolean> {
	if (!/^[0-9a-f-]{36}$/i.test(principalId)) return false;
	const [row] = await tx
		.select({ id: roleBindings.id })
		.from(roleBindings)
		.where(and(eq(roleBindings.accountId, accountId), eq(roleBindings.principalId, principalId)))
		.limit(1);
	return row !== undefined;
}

/**
 * Moves a pinned process on a case to its definition's latest published version: an explicit,
 * recorded move (ADR 0016), which needs write on the case's namespace.
 */
export async function moveToLatest(
	db: Db,
	actor: Actor,
	attachmentId: string
): Promise<{ ok: true; version: number } | RuntimeRefusal> {
	const missing = refuse('not-found', 'That process is not on a case.');
	if (!/^[0-9a-f-]{36}$/i.test(attachmentId)) return missing;
	const [run] = await db
		.select({ definitionId: definitionVersions.definitionId })
		.from(caseAttachments)
		.innerJoin(definitionVersions, eq(definitionVersions.id, caseAttachments.definitionVersionId))
		.where(eq(caseAttachments.id, attachmentId));
	if (!run) return missing;
	const [latest] = await db
		.select({ id: definitionVersions.id, version: definitionVersions.version })
		.from(definitionVersions)
		.where(
			and(
				eq(definitionVersions.definitionId, run.definitionId),
				eq(definitionVersions.status, 'published')
			)
		)
		.orderBy(desc(definitionVersions.version))
		.limit(1);
	if (!latest) return missing;
	return attempt(async () => {
		try {
			await moveAttachmentVersion(
				db,
				{ attachmentId, toVersionId: latest.id, movedById: actor.id },
				{ actor }
			);
		} catch (error) {
			if (error instanceof AccessDeniedError)
				throw new Refused(refuse('access-denied', error.reason));
			throw error;
		}
		return { ok: true as const, version: latest.version };
	});
}

// Work items

/** Names one work item of one process on a case. */
export interface ItemRef {
	attachmentId: string;
	item: string;
}

interface ItemContext {
	tx: Tx;
	who: Acting;
	c: LoadedCase;
	a: LoadedAttachment;
	state: ItemState;
}

/**
 * Locks the case the item belongs to, loads it fresh, and checks that the actor may act in the
 * item's role, before handing over to `work`.
 */
function onItem<T>(
	db: Db,
	actor: Actor,
	ref: ItemRef,
	options: RuntimeOptions,
	work: (ctx: ItemContext) => Promise<T>
): Promise<T | RuntimeRefusal> {
	const now = options.now ?? new Date();
	return attempt(() =>
		db.transaction(async (tx) => {
			const notFound = () => new Refused(refuse('not-found', 'That task does not exist.'));
			if (!/^[0-9a-f-]{36}$/i.test(ref.attachmentId)) throw notFound();
			const [row] = await tx
				.select({ caseId: caseAttachments.caseId })
				.from(caseAttachments)
				.where(eq(caseAttachments.id, ref.attachmentId));
			if (!row) throw notFound();
			await tx.select({ id: cases.id }).from(cases).where(eq(cases.id, row.caseId)).for('update');
			const {
				cases: [c]
			} = await loadCases(tx, [row.caseId], now);
			const a = c?.attachments.find((x) => x.id === ref.attachmentId);
			const state = a?.state.items.find((i) => i.item.id === ref.item);
			if (!c || !a || !state) throw notFound();
			await check(
				tx,
				actor,
				'case.act_in_role',
				{ type: 'case-role', caseId: c.id, role: state.item.role },
				now
			);
			const who = await acting(tx, actor, now);
			return work({ tx, who, c, a, state });
		})
	);
}

const done = { ok: true as const };

async function requireOpen(tx: Tx, state: ItemState) {
	const { status, progress, item } = state;
	if (status === 'done') {
		const by = progress.done ? ` ${await nameOf(tx, progress.done.by)} finished it first.` : '';
		throw new Refused(refuse('already-done', `“${item.title}” is already done.${by}`));
	}
	if (status === 'skipped') {
		throw new Refused(refuse('already-done', `“${item.title}” does not apply on this case.`));
	}
	if (status === 'upcoming') {
		throw new Refused(
			refuse('not-ready', `“${item.title}” cannot start yet: its stage has not been reached.`)
		);
	}
}

async function nameOf(tx: Tx, id: string) {
	const [row] = await tx
		.select({ name: principals.displayName })
		.from(principals)
		.where(eq(principals.id, id));
	return row?.name ?? 'Someone';
}

/**
 * Notes that the actor has started filling an item in, so others see who is on it. There is no
 * claim: whoever finishes first completes it (the runner's design decision).
 */
export function startItem(db: Db, actor: Actor, ref: ItemRef, options: RuntimeOptions = {}) {
	return onItem(db, actor, ref, options, async ({ tx, who, c, a, state }) => {
		if (state.status !== 'ready' && state.status !== 'held') return done;
		const by = who.actor.onBehalfOfId ?? who.actor.id;
		if (state.progress.started.some((s) => s.by === who.actor.id || s.by === by)) return done;
		await record(tx, who, {
			caseId: c.id,
			attachmentId: a.id,
			item: ref.item,
			type: 'step.started'
		});
		return done;
	});
}

/** Pauses an item because information is missing; the note says what. */
export function holdItem(
	db: Db,
	actor: Actor,
	ref: ItemRef & { note: string },
	options: RuntimeOptions = {}
) {
	return onItem(db, actor, ref, options, async ({ tx, who, c, a, state }) => {
		await requireOpen(tx, state);
		const note = ref.note.trim();
		if (!note) {
			throw new Refused(
				refuse('invalid-input', 'Say what is missing, so whoever is waiting knows.', [
					{ field: 'note', message: 'Say what is missing' }
				])
			);
		}
		await record(tx, who, {
			caseId: c.id,
			attachmentId: a.id,
			item: ref.item,
			type: 'step.held',
			data: { note }
		});
		return done;
	});
}

/** Takes a paused item off hold. */
export function resumeItem(db: Db, actor: Actor, ref: ItemRef, options: RuntimeOptions = {}) {
	return onItem(db, actor, ref, options, async ({ tx, who, c, a, state }) => {
		if (state.status !== 'held') return done;
		await record(tx, who, {
			caseId: c.id,
			attachmentId: a.id,
			item: ref.item,
			type: 'step.resumed'
		});
		return done;
	});
}

/**
 * Records that an item does not apply on this case. Only an item whose condition is prose, which
 * its role decides (ADR 0004), or a repeating step whose end condition is prose can be skipped.
 */
export function skipItem(
	db: Db,
	actor: Actor,
	ref: ItemRef & { reason: string },
	options: RuntimeOptions = {}
) {
	return onItem(db, actor, ref, options, async ({ tx, who, c, a, state }) => {
		await requireOpen(tx, state);
		if (!skippable(state)) {
			throw new Refused(
				refuse('not-ready', `“${state.item.title}” always applies here, so it cannot be skipped.`)
			);
		}
		const reason = ref.reason.trim();
		if (!reason) {
			throw new Refused(
				refuse('invalid-input', 'Say why it does not apply.', [
					{ field: 'reason', message: 'Say why it does not apply' }
				])
			);
		}
		await record(tx, who, {
			caseId: c.id,
			attachmentId: a.id,
			item: ref.item,
			type: 'step.skipped',
			data: { reason }
		});
		await recordProgress(tx, who, c);
		return done;
	});
}

/** True when the item's role decides whether it applies: a prose condition, or a prose end. */
export function skippable(state: ItemState): boolean {
	const until = state.item.repeat?.until;
	return state.guard === 'open' || (until !== undefined && until.expr === undefined);
}

/** A file sent with a completed item: for a fact (`fact:<id>`) or a step's evidence (`evidence:<n>`). */
export interface Upload {
	slot: string;
	name: string;
	contentType: string;
	bytes: Uint8Array;
}

export interface Completion extends ItemRef {
	/** What the form sent for each fact, by fact id, as text. */
	values?: Record<string, string[]>;
	files?: Upload[];
}

export interface Completed {
	ok: true;
	/** The facts recorded, by fact id. */
	recorded: string[];
}

const MAX_FILE_BYTES = 20 * 1024 * 1024;

/**
 * Completes a step or decision: records the facts the actor's role collects, attaches the files,
 * assigns any roles the step assigns from what it recorded, and moves the case on.
 *
 * Every fact the item's role collects needs a value, new or already recorded on the case: facts are
 * shared case-wide, so a value another process recorded counts (ADR 0001). An unchanged value is
 * not recorded again. A file fact takes an uploaded file as its value. A step marked `human` is
 * refused to agents (ADR 0009). Whoever finishes first wins; a second completion is refused.
 */
export function completeItem(
	db: Db,
	actor: Actor,
	input: Completion,
	options: RuntimeOptions & { files: FileStore }
): Promise<Completed | RuntimeRefusal> {
	return onItem(db, actor, input, options, async ({ tx, who, c, a, state }) => {
		const { item } = state;
		if (item.kind === 'approval') {
			throw new Refused(
				refuse('invalid-input', 'An approval is approved or sent back, not completed.')
			);
		}
		await requireOpen(tx, state);
		if (state.status === 'waiting' || state.status === 'blocked') {
			throw new Refused(
				refuse(
					'not-ready',
					`“${item.title}” cannot be done yet: it needs information that is not recorded.`
				)
			);
		}
		if (item.actor === 'human' && who.kind !== 'user') {
			throw new Refused(
				refuse('human-only', `Only a person can complete “${item.title}”, not a ${who.kind}.`)
			);
		}

		const problems: FieldProblem[] = [];
		const uploads = input.files ?? [];
		const facts = collectedBy(item);
		for (const u of uploads) {
			const factId = u.slot.startsWith('fact:') ? u.slot.slice(5) : undefined;
			const index = u.slot.startsWith('evidence:') ? Number(u.slot.slice(9)) : undefined;
			const expected =
				(factId !== undefined &&
					(facts.includes(factId as never) || item.evidence.some((e) => e.fact === factId))) ||
				(index !== undefined && Number.isInteger(index) && item.evidence[index] !== undefined);
			if (!expected) problems.push({ field: u.slot, message: `${u.name} is not asked for here` });
			else if (u.bytes.byteLength > MAX_FILE_BYTES) {
				problems.push({ field: u.slot, message: `${u.name} is larger than 20 MB` });
			}
		}
		const values = new Map<string, unknown>();
		for (const factId of facts) {
			const fact = a.process.facts.get(factId) as FactNode;
			const title = fact.core.title ?? factId;
			const existing = c.facts.get(factId);
			let value: unknown;
			if (isFileFact(fact.core.schema)) {
				if (uploads.some((u) => u.slot === `fact:${factId}`)) value = 'pending-file';
			} else {
				const read = readFactInput(fact.core.schema, input.values?.[factId] ?? []);
				if (!read.ok) {
					problems.push({ field: factId, message: `${title}: ${read.problem}` });
					continue;
				}
				value = read.value;
			}
			if (value === undefined) {
				if (existing && !item.repeat) continue;
				problems.push({ field: factId, message: `${title} is needed` });
				continue;
			}
			if (value === 'pending-file') {
				values.set(factId, value);
				continue;
			}
			const problem = factValueProblem(fact, value);
			if (problem) {
				problems.push({ field: factId, message: problem });
				continue;
			}
			if (fact.core.schema['x-lookup']?.kind === 'principal') {
				for (const id of Array.isArray(value) ? value : [value]) {
					if (!(await knownInAccount(tx, c.accountId, String(id)))) {
						problems.push({
							field: factId,
							message: `${title}: choose someone who belongs to this casebook`
						});
					}
				}
			}
			if (!item.repeat && existing && JSON.stringify(existing.value) === JSON.stringify(value))
				continue;
			values.set(factId, value);
		}
		if (problems.length) {
			throw new Refused(
				refuse('invalid-input', problems.map((p) => p.message).join('; '), problems)
			);
		}

		const completion = await record(tx, who, {
			caseId: c.id,
			attachmentId: a.id,
			item: item.id,
			type: item.kind === 'decision' ? 'decision.made' : 'step.completed',
			data: { facts: [...values.keys()] }
		});
		const stored: string[] = [];
		try {
			for (const u of uploads) {
				const factId = u.slot.startsWith('fact:') ? u.slot.slice(5) : undefined;
				const evidenceIndex = u.slot.startsWith('evidence:') ? Number(u.slot.slice(9)) : undefined;
				const evidence =
					evidenceIndex !== undefined
						? item.evidence[evidenceIndex]
						: item.evidence.find((e) => e.fact === factId);
				const fact = factId ? a.process.facts.get(factId) : undefined;
				const key = await options.files.put(u.bytes);
				stored.push(key);
				const event = await record(tx, who, {
					caseId: c.id,
					attachmentId: a.id,
					item: item.id,
					type: 'evidence.attached',
					data: { name: u.name, ...(factId ? { fact: factId } : {}), completion }
				});
				const [file] = await tx
					.insert(caseFiles)
					.values({
						caseId: c.id,
						fact: factId ?? evidence?.fact ?? null,
						evidence: evidence?.description ?? fact?.core.schema['x-evidence']?.description ?? null,
						name: u.name.slice(0, 200) || 'file',
						contentType: u.contentType || 'application/octet-stream',
						size: u.bytes.byteLength,
						storageKey: key,
						eventId: event
					})
					.returning({ id: caseFiles.id });
				if (factId && values.get(factId) === 'pending-file') {
					values.set(factId, fileReference(file!.id));
				}
			}
			for (const [factId, value] of values) {
				const event = await record(tx, who, {
					caseId: c.id,
					attachmentId: a.id,
					item: item.id,
					type: 'fact.recorded',
					data: { fact: factId, completion }
				});
				await tx.insert(caseFacts).values({ caseId: c.id, fact: factId, value, eventId: event });
			}
			for (const { role, fact } of item.assigns) {
				const value = values.get(fact) ?? c.facts.get(fact)?.value;
				for (const id of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
					await bindCaseRole(tx, who, c, a, role, String(id));
				}
			}
			await recordProgress(tx, who, c);
		} catch (error) {
			await Promise.allSettled(stored.map((key) => options.files.delete(key)));
			throw error;
		}
		return { ok: true as const, recorded: [...values.keys()] };
	});
}

export interface ApprovalDecision extends ItemRef {
	approve: boolean;
	/** Why it is sent back; needed when it is. */
	note?: string;
}

/**
 * Approves the step an approval reviews, or sends it back with a note so its role does it again.
 * Approvals are human-only, and nobody approves their own work (ADR 0009, ADR 0017).
 */
export function decideApproval(
	db: Db,
	actor: Actor,
	input: ApprovalDecision,
	options: RuntimeOptions = {}
) {
	return onItem(db, actor, input, options, async ({ tx, who, c, a, state }) => {
		const { item } = state;
		if (item.kind !== 'approval') {
			throw new Refused(refuse('invalid-input', `“${item.title}” is not an approval.`));
		}
		await requireOpen(tx, state);
		if (state.status !== 'ready') {
			throw new Refused(refuse('not-ready', `“${item.title}” waits for the work it reviews.`));
		}
		const doneEvent = [...a.events]
			.reverse()
			.find((e) => e.item === item.reviews && e.type === 'step.completed');
		const problem = workApprovalProblem({
			approver: { id: who.actor.id, kind: who.kind },
			...(who.actor.onBehalfOfId ? { approverOnBehalfOf: { id: who.actor.onBehalfOfId } } : {}),
			doneBy: { id: doneEvent?.by ?? '' },
			...(doneEvent?.onBehalfOf ? { doneOnBehalfOf: { id: doneEvent.onBehalfOf } } : {})
		});
		if (problem) {
			const reason = problem.charAt(0).toUpperCase() + problem.slice(1);
			throw new Refused(refuse(who.kind === 'user' ? 'access-denied' : 'human-only', `${reason}.`));
		}
		const note = input.note?.trim() ?? '';
		if (!input.approve && !note) {
			throw new Refused(
				refuse('invalid-input', 'Say what needs to change before you send it back.', [
					{ field: 'note', message: 'Say what needs to change' }
				])
			);
		}
		await record(tx, who, {
			caseId: c.id,
			attachmentId: a.id,
			item: item.id,
			type: input.approve ? 'approval.granted' : 'approval.rejected',
			data: note ? { note } : {}
		});
		await recordProgress(tx, who, c);
		return done;
	});
}
