import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { approvalProblem, can, type Action, type Actor, type Resource } from '../src/authz.js';
import { createDb, type Db } from '../src/client.js';
import {
	AccessDeniedError,
	addGroupMember,
	appendDraftRevision,
	bindRole,
	createAccount,
	createCase,
	createNamespace,
	createPrincipal,
	createProcessDefinition,
	grantDelegation,
	moveCaseVersion,
	publishVersion,
	retireVersion,
	revokeDelegation,
	StoreRuleError,
	type ChangePolicy,
	type PrincipalKind,
	type StoreRule
} from '../src/repository.js';
import { roleBindings } from '../src/schema.js';

describe('approvalProblem', () => {
	const user = (id: string) => ({ id, kind: 'user' as const });

	it('allows a human approver who neither publishes nor is represented', () => {
		expect(
			approvalProblem({ approver: user('b'), publishedBy: user('a'), onBehalfOf: user('c') })
		).toBeUndefined();
	});

	it('refuses agents, services and groups as approvers', () => {
		for (const kind of ['agent', 'service', 'group'] as const) {
			expect(approvalProblem({ approver: { id: 'x', kind }, publishedBy: user('a') })).toMatch(
				/human-only/
			);
		}
	});

	it('refuses self-approval by the publisher or the represented principal', () => {
		expect(approvalProblem({ approver: user('a'), publishedBy: user('a') })).toMatch(/publisher/);
		expect(
			approvalProblem({
				approver: user('c'),
				publishedBy: { id: 'agent', kind: 'agent' },
				onBehalfOf: user('c')
			})
		).toMatch(/on behalf of cannot approve/);
	});

	it('refuses an approver acting on behalf of someone else', () => {
		expect(
			approvalProblem({
				approver: user('b'),
				approverOnBehalfOf: user('c'),
				publishedBy: user('a')
			})
		).toMatch(/approves for themselves/);
	});
});

const url = inject('testDatabaseUrl');

describe.skipIf(!url)('permission resolution (Postgres)', () => {
	let db: Db;

	beforeAll(() => {
		db = createDb(url!);
	});
	afterAll(async () => {
		await db?.$client.end();
	});

	function principal(kind: PrincipalKind, name?: string, ownerId?: string) {
		return createPrincipal(db, {
			kind,
			displayName: name ?? `${kind} ${randomUUID()}`,
			issuer: 'casebook',
			subject: randomUUID(),
			...(ownerId === undefined ? {} : { ownerId })
		});
	}

	/**
	 * A fresh account `acme` with namespaces acme, acme/eng, acme/eng/sre and acme/ops, a published
	 * definition in acme/eng/sre with a pinned case, and a definition in acme/ops.
	 */
	async function world() {
		const owner = await principal('user', 'Olive');
		const account = await createAccount(db, {
			slug: `acme-${randomUUID()}`,
			displayName: 'Acme',
			createdById: owner.id
		});
		const accountId = account.id;
		const ns: Record<'root' | 'eng' | 'sre' | 'ops', string> = {
			root: '',
			eng: '',
			sre: '',
			ops: ''
		};
		for (const [key, path] of [
			['root', 'acme'],
			['eng', 'acme/eng'],
			['sre', 'acme/eng/sre'],
			['ops', 'acme/ops']
		] as const) {
			ns[key] = (await createNamespace(db, { accountId, path, createdById: owner.id })).id;
		}
		const sreDef = await definition(ns.sre, owner.id, 'incident');
		const opsDef = await definition(ns.ops, owner.id, 'billing');
		const v1 = await publish(sreDef.id, owner.id);
		const v2 = await publish(sreDef.id, owner.id);
		const incident = await createCase(db, {
			namespaceId: ns.sre,
			definitionVersionId: v1.id,
			title: 'Outage'
		});
		const other = await createCase(db, {
			namespaceId: ns.sre,
			definitionVersionId: v1.id,
			title: 'Latency'
		});

		/** A new user bound to `role` at account scope, or in a namespace or case when given. */
		async function holder(role: string, scope: { namespaceId?: string; caseId?: string } = {}) {
			const user = await principal('user', `${role} holder`);
			await bindRole(db, {
				principalId: user.id,
				role,
				accountId,
				...scope,
				...(scope.caseId === undefined ? {} : { namespaceId: ns.sre })
			});
			return user;
		}
		return { owner, accountId, ns, sreDef, opsDef, v1, v2, incident, other, holder };
	}

	function definition(
		namespaceId: string,
		ownerId: string,
		slug: string,
		changePolicy: ChangePolicy = 'governed'
	) {
		return createProcessDefinition(db, {
			namespaceId,
			slug,
			ownerId,
			createdById: ownerId,
			changePolicy
		});
	}

	function publish(definitionId: string, publisherId: string) {
		return publishVersion(db, {
			definitionId,
			body: { title: 'Incident' },
			schemaVersion: '1',
			contentHash: `sha256:${randomUUID()}`,
			authorId: publisherId,
			publishedById: publisherId
		});
	}

	const tomorrow = () => new Date(Date.now() + 86_400_000);

	async function check(actor: Actor | string, action: Action, resource: Resource, now?: Date) {
		const who = typeof actor === 'string' ? { id: actor } : actor;
		return can(db, who, action, resource, now === undefined ? {} : { now });
	}

	async function expectAllowed(
		decision: Promise<{ allowed: boolean; reason: string }>,
		reason?: RegExp
	) {
		const { allowed, reason: why } = await decision;
		expect(allowed, why).toBe(true);
		if (reason) expect(why).toMatch(reason);
	}

	async function expectRefused(
		decision: Promise<{ allowed: boolean; reason: string }>,
		reason?: RegExp
	) {
		const { allowed, reason: why } = await decision;
		expect(allowed, why).toBe(false);
		if (reason) expect(why).toMatch(reason);
	}

	const definitionOf = (id: string) => ({ type: 'definition', definitionId: id }) as const;
	const namespaceOf = (id: string) => ({ type: 'namespace', namespaceId: id }) as const;

	describe('account roles', () => {
		it('makes owners and admins namespace-admin on every namespace in the account', async () => {
			const w = await world();
			const admin = await w.holder('account-admin');
			await expectAllowed(
				check(w.owner.id, 'namespace.manage', namespaceOf(w.ns.sre)),
				/is account-owner of account "acme-[^"]+", which gives namespace-admin on every namespace in it/
			);
			await expectAllowed(check(admin.id, 'definition.retire', definitionOf(w.opsDef.id)));
			await expectAllowed(check(admin.id, 'namespace.manage_permissions', namespaceOf(w.ns.root)));
			for (const manager of [w.owner, admin]) {
				await expectAllowed(
					check(manager.id, 'account.manage_members', { type: 'account', accountId: w.accountId })
				);
			}
		});

		it('lets developers create namespaces and administer only the ones they create', async () => {
			const w = await world();
			const developer = await w.holder('developer');
			const account = { type: 'account', accountId: w.accountId } as const;
			await expectAllowed(check(developer.id, 'namespace.create', account), /is developer/);
			await expectAllowed(check(developer.id, 'namespace.create', namespaceOf(w.ns.ops)));
			await expectRefused(
				check(developer.id, 'namespace.manage', namespaceOf(w.ns.eng)),
				/needs namespace-admin on acme\/eng or an ancestor, or account-owner or account-admin in account/
			);
			await expectRefused(check(developer.id, 'account.manage_members', account));
			await expectRefused(check(developer.id, 'definition.edit', definitionOf(w.sreDef.id)));
			await expectAllowed(
				check(developer.id, 'definition.read', definitionOf(w.sreDef.id)),
				/which gives read/
			);

			const lab = await createNamespace(db, {
				accountId: w.accountId,
				path: 'acme/lab',
				createdById: developer.id
			});
			await expectAllowed(
				check(developer.id, 'namespace.manage', namespaceOf(lab.id)),
				/holds namespace-admin on acme\/lab$/
			);
		});

		it('lets read-only members read and nothing more', async () => {
			const w = await world();
			const reader = await w.holder('read-only');
			await expectAllowed(check(reader.id, 'definition.read', namespaceOf(w.ns.ops)));
			await expectRefused(
				check(reader.id, 'definition.edit', definitionOf(w.sreDef.id)),
				/it holds read-only on account "acme-[^"]+"$/
			);
			await expectRefused(
				check(reader.id, 'namespace.create', { type: 'account', accountId: w.accountId })
			);
		});
	});

	describe('namespace permissions', () => {
		it('inherits permissions down the namespace tree, never up or sideways', async () => {
			const w = await world();
			const writer = await w.holder('write', { namespaceId: w.ns.eng });
			await expectAllowed(
				check(writer.id, 'definition.edit', definitionOf(w.sreDef.id)),
				/holds write on acme\/eng, inherited by acme\/eng\/sre$/
			);
			await expectAllowed(check(writer.id, 'definition.create', namespaceOf(w.ns.sre)));
			await expectAllowed(check(writer.id, 'definition.create', namespaceOf(w.ns.eng)));
			await expectRefused(check(writer.id, 'definition.create', namespaceOf(w.ns.root)));
			await expectRefused(
				check(writer.id, 'definition.edit', definitionOf(w.opsDef.id)),
				/cannot edit the draft of definition "billing" in acme\/ops: .* it holds no role in account/
			);
		});

		it('ranks namespace-admin above write above read', async () => {
			const w = await world();
			const reader = await w.holder('read', { namespaceId: w.ns.eng });
			const writer = await w.holder('write', { namespaceId: w.ns.eng });
			const admin = await w.holder('namespace-admin', { namespaceId: w.ns.eng });
			const def = definitionOf(w.sreDef.id);

			await expectAllowed(check(reader.id, 'definition.read', def));
			await expectRefused(
				check(reader.id, 'definition.publish', def),
				/needs write or namespace-admin on acme\/eng\/sre or an ancestor.*it holds read on acme\/eng$/
			);
			await expectAllowed(check(writer.id, 'definition.publish', def));
			await expectRefused(check(writer.id, 'definition.retire', def));
			await expectRefused(check(writer.id, 'namespace.create', namespaceOf(w.ns.sre)));
			await expectAllowed(check(admin.id, 'definition.retire', def));
			await expectAllowed(check(admin.id, 'namespace.manage_permissions', namespaceOf(w.ns.sre)));
			await expectAllowed(check(admin.id, 'namespace.create', namespaceOf(w.ns.sre)));
			await expectRefused(check(admin.id, 'namespace.manage', namespaceOf(w.ns.ops)));
		});

		it('honours permissions held through nested groups', async () => {
			const w = await world();
			const platform = await principal('group', 'Platform');
			const sre = await principal('group', 'SRE');
			const user = await principal('user', 'Sam');
			await addGroupMember(db, platform.id, sre.id);
			await addGroupMember(db, sre.id, user.id);
			await bindRole(db, {
				principalId: platform.id,
				role: 'write',
				accountId: w.accountId,
				namespaceId: w.ns.eng
			});
			await expectAllowed(
				check(user.id, 'definition.edit', definitionOf(w.sreDef.id)),
				/user "Sam" holds write on acme\/eng, inherited by acme\/eng\/sre through group "Platform"/
			);
			await expectRefused(check(user.id, 'definition.edit', definitionOf(w.opsDef.id)));
		});
	});

	describe('case bindings', () => {
		it('resolves process roles on the case, then standing roles along the namespace lineage', async () => {
			const w = await world();
			const commander = await w.holder('commander', { caseId: w.incident.id });
			const responder = await w.holder('responder', { namespaceId: w.ns.eng });
			const role = (caseId: string, name: string) =>
				({ type: 'case-role', caseId, role: name }) as const;

			await expectAllowed(
				check(commander.id, 'case.act_in_role', role(w.incident.id, 'commander')),
				/is bound as commander on this case/
			);
			await expectRefused(
				check(commander.id, 'case.act_in_role', role(w.other.id, 'commander')),
				/needs the role commander on this case, or as a standing role on acme\/eng\/sre or an ancestor/
			);
			await expectRefused(check(commander.id, 'case.act_in_role', role(w.incident.id, 'scribe')));
			await expectAllowed(
				check(responder.id, 'case.act_in_role', role(w.other.id, 'responder')),
				/holds the standing role responder on acme\/eng, inherited by acme\/eng\/sre/
			);
			// Administering the namespace does not make anyone a participant in its processes.
			await expectRefused(check(w.owner.id, 'case.act_in_role', role(w.incident.id, 'commander')));
		});

		it('moves a case version only with write on its namespace', async () => {
			const w = await world();
			const commander = await w.holder('commander', { caseId: w.incident.id });
			const writer = await w.holder('write', { namespaceId: w.ns.sre });
			const incident = { type: 'case', caseId: w.incident.id } as const;
			await expectRefused(
				check(commander.id, 'case.bind_version', incident),
				/it holds commander on this case$/
			);
			await expectAllowed(check(writer.id, 'case.bind_version', incident));
		});
	});

	describe('account isolation and resources', () => {
		it('never applies roles across accounts', async () => {
			const acme = await world();
			const beta = await world();
			await expectRefused(
				check(beta.owner.id, 'definition.read', definitionOf(acme.sreDef.id)),
				/holds no role in account "acme-[^"]+"; roles in other accounts never apply here$/
			);
			await expectRefused(check(acme.owner.id, 'namespace.manage', namespaceOf(beta.ns.root)));
			await expectRefused(
				check(acme.owner.id, 'account.manage_members', {
					type: 'account',
					accountId: beta.accountId
				})
			);
		});

		it('refuses the wrong kind of resource and resources that do not exist', async () => {
			const w = await world();
			await expectRefused(
				check(w.owner.id, 'definition.edit', namespaceOf(w.ns.eng)),
				/definition.edit applies to definition, not to namespace/
			);
			await expectRefused(
				check(w.owner.id, 'definition.approve', definitionOf(w.sreDef.id)),
				/applies to publication/
			);
			await expectRefused(
				check(w.owner.id, 'definition.read', definitionOf(randomUUID())),
				/does not exist/
			);
			await expectRefused(check(randomUUID(), 'definition.read', definitionOf(w.sreDef.id)));
		});

		it('lets users act only for themselves, and never lets a group act', async () => {
			const w = await world();
			const group = await principal('group', 'Ops');
			await bindRole(db, { principalId: group.id, role: 'account-admin', accountId: w.accountId });
			const writer = await w.holder('write', { namespaceId: w.ns.eng });
			await expectRefused(
				check(
					{ id: writer.id, onBehalfOfId: w.owner.id },
					'definition.read',
					namespaceOf(w.ns.eng)
				),
				/acts only for themselves/
			);
			await expectRefused(
				check(group.id, 'definition.read', namespaceOf(w.ns.eng)),
				/cannot act itself/
			);
		});
	});

	describe('agent delegation', () => {
		async function delegated(
			w: Awaited<ReturnType<typeof world>>,
			user: { id: string },
			limits: { namespaceId?: string; caseId?: string; role?: string; expiresAt?: Date } = {}
		) {
			const agent = await principal('agent', 'Scribe bot');
			const grant = await grantDelegation(db, {
				delegatorId: user.id,
				agentId: agent.id,
				expiresAt: limits.expiresAt ?? tomorrow(),
				...(limits.namespaceId === undefined ? {} : { namespaceId: limits.namespaceId }),
				...(limits.caseId === undefined ? {} : { caseId: limits.caseId, namespaceId: w.ns.sre }),
				...(limits.role === undefined ? {} : { role: limits.role })
			});
			return { agent, grant, as: { id: agent.id, onBehalfOfId: user.id } };
		}

		it('needs an on-behalf-of principal and a grant, and ignores the agent’s own bindings', async () => {
			const w = await world();
			const agent = await principal('agent', 'Rogue bot');
			const user = await w.holder('write', { namespaceId: w.ns.eng });
			await bindRole(db, {
				principalId: agent.id,
				role: 'namespace-admin',
				accountId: w.accountId,
				namespaceId: w.ns.eng
			});
			const def = definitionOf(w.sreDef.id);
			await expectRefused(check(agent.id, 'definition.read', def), /must act on behalf of/);
			await expectRefused(
				check({ id: agent.id, onBehalfOfId: user.id }, 'definition.read', def),
				/has not granted agent "Rogue bot" a delegation/
			);
			const other = await principal('agent');
			await expectRefused(
				check({ id: agent.id, onBehalfOfId: other.id }, 'definition.read', def),
				/nobody acts on behalf of an agent/
			);
		});

		it('allows only what both the grant and the user allow', async () => {
			const w = await world();
			const user = await w.holder('write', { namespaceId: w.ns.eng });
			const { as, grant } = await delegated(w, user);
			await expectAllowed(
				check(as, 'definition.edit', definitionOf(w.sreDef.id)),
				new RegExp(
					`acts for user "write holder" under delegation grant ${grant.id} \\(any namespace, until .*\\), and user "write holder" holds write on acme/eng`
				)
			);
			// The grant is unlimited, but the user cannot edit in acme/ops, so neither can the agent.
			await expectRefused(
				check(as, 'definition.edit', definitionOf(w.opsDef.id)),
				/under delegation grant .*, but user "write holder" cannot edit the draft of definition "billing"/
			);
		});

		it('applies the namespace, case and role limits of a grant', async () => {
			const w = await world();
			const admin = await w.holder('account-admin');
			await bindRole(db, {
				principalId: admin.id,
				role: 'commander',
				accountId: w.accountId,
				namespaceId: w.ns.sre,
				caseId: w.incident.id
			});

			const inEng = await delegated(w, admin, { namespaceId: w.ns.eng });
			await expectAllowed(check(inEng.as, 'namespace.manage', namespaceOf(w.ns.sre)));
			await expectRefused(
				check(inEng.as, 'namespace.manage', namespaceOf(w.ns.ops)),
				/covers namespace acme\/ops: grant .* is limited to namespace acme\/eng$/
			);
			await expectRefused(
				check(inEng.as, 'namespace.create', { type: 'account', accountId: w.accountId })
			);

			const readOnly = await delegated(w, admin, { role: 'read' });
			await expectAllowed(check(readOnly.as, 'definition.read', definitionOf(w.sreDef.id)));
			await expectRefused(
				check(readOnly.as, 'definition.edit', definitionOf(w.sreDef.id)),
				/is limited to the role read, which does not allow this/
			);

			const onCase = await delegated(w, admin, { caseId: w.incident.id, role: 'commander' });
			const commander = (caseId: string) =>
				({ type: 'case-role', caseId, role: 'commander' }) as const;
			await expectAllowed(check(onCase.as, 'case.act_in_role', commander(w.incident.id)));
			await expectRefused(
				check(onCase.as, 'case.act_in_role', commander(w.other.id)),
				/is limited to another case/
			);
			await expectRefused(
				check(onCase.as, 'case.bind_version', { type: 'case', caseId: w.incident.id }),
				/limited to the role commander/
			);
			await expectRefused(check(onCase.as, 'definition.edit', definitionOf(w.sreDef.id)));
		});

		it('refuses a grant limited to a namespace in another account', async () => {
			const acme = await world();
			const beta = await world();
			const user = await acme.holder('account-admin');
			await bindRole(db, {
				principalId: user.id,
				role: 'account-admin',
				accountId: beta.accountId
			});
			const { as } = await delegated(beta, user, { namespaceId: beta.ns.root });
			await expectRefused(
				check(as, 'definition.read', definitionOf(acme.sreDef.id)),
				/is limited to namespace acme in another account/
			);
			await expectAllowed(check(as, 'definition.read', definitionOf(beta.sreDef.id)));
		});

		it('refuses expired and revoked grants', async () => {
			const w = await world();
			const user = await w.holder('write', { namespaceId: w.ns.eng });
			const expiresAt = new Date(Date.now() + 3_600_000);
			const { as, grant } = await delegated(w, user, { expiresAt });
			const def = definitionOf(w.sreDef.id);

			await expectAllowed(check(as, 'definition.edit', def));
			await expectRefused(
				check(as, 'definition.edit', def, new Date(expiresAt.getTime() + 1)),
				new RegExp(
					`no active delegation from user "write holder": the latest grant expired at ${expiresAt.toISOString()}`
				)
			);
			await revokeDelegation(db, grant.id);
			await expectRefused(check(as, 'definition.edit', def), /the latest grant was revoked at/);
		});

		it('gives an unattended agent its owning service’s authority, and nothing for others', async () => {
			const w = await world();
			const service = await principal('service', 'Importer');
			const stranger = await principal('service', 'Stranger');
			const group = await principal('group', 'Responders');
			await bindRole(db, {
				principalId: service.id,
				role: 'write',
				accountId: w.accountId,
				namespaceId: w.ns.eng
			});
			const agent = await principal('agent', 'Import bot', service.id);
			const def = definitionOf(w.sreDef.id);
			await expectAllowed(
				check({ id: agent.id, onBehalfOfId: service.id }, 'definition.edit', def),
				/acts unattended for its owning service "Importer", and service "Importer" holds write on acme\/eng/
			);
			await expectRefused(
				check(
					{ id: agent.id, onBehalfOfId: service.id },
					'definition.edit',
					definitionOf(w.opsDef.id)
				)
			);
			await expectRefused(
				check({ id: agent.id, onBehalfOfId: stranger.id }, 'definition.edit', def),
				/is not owned by service "Stranger"/
			);
			await expectRefused(
				check({ id: agent.id, onBehalfOfId: group.id }, 'definition.edit', def),
				/acting for a group is not supported/
			);
		});

		it('lets a service act on its own bindings, within those of any principal it represents', async () => {
			const w = await world();
			const service = await principal('service', 'Sync');
			await bindRole(db, {
				principalId: service.id,
				role: 'write',
				accountId: w.accountId,
				namespaceId: w.ns.eng
			});
			const reader = await w.holder('read', { namespaceId: w.ns.eng });
			const def = definitionOf(w.sreDef.id);
			await expectAllowed(check(service.id, 'definition.edit', def));
			await expectRefused(
				check({ id: service.id, onBehalfOfId: reader.id }, 'definition.edit', def),
				/acting on behalf of user "read holder", but user "read holder" cannot edit/
			);
		});
	});

	describe('approvals', () => {
		it('lets another writer approve, never the publisher or the principal it publishes for', async () => {
			const w = await world();
			const publisher = await w.holder('write', { namespaceId: w.ns.eng });
			const reviewer = await w.holder('write', { namespaceId: w.ns.sre });
			const reader = await w.holder('read', { namespaceId: w.ns.sre });
			const publication = (publishedById: string, onBehalfOfId?: string): Resource => ({
				type: 'publication',
				definitionId: w.sreDef.id,
				publishedById,
				...(onBehalfOfId === undefined ? {} : { onBehalfOfId })
			});

			await expectAllowed(
				check(reviewer.id, 'definition.approve', publication(publisher.id)),
				/holds write on acme\/eng\/sre$/
			);
			await expectRefused(
				check(publisher.id, 'definition.approve', publication(publisher.id)),
				/the publisher cannot approve their own publish/
			);
			const agent = await principal('agent');
			await expectRefused(
				check(reviewer.id, 'definition.approve', publication(agent.id, reviewer.id)),
				/the principal the publish is made on behalf of cannot approve it/
			);
			await expectRefused(
				check(reader.id, 'definition.approve', publication(publisher.id)),
				/cannot approve publishing definition "incident" in acme\/eng\/sre: that needs write/
			);
		});

		it('keeps approvals human-only, even for an agent with a delegation', async () => {
			const w = await world();
			const publisher = await w.holder('write', { namespaceId: w.ns.eng });
			const reviewer = await w.holder('write', { namespaceId: w.ns.eng });
			const agent = await principal('agent', 'Review bot');
			await grantDelegation(db, {
				delegatorId: reviewer.id,
				agentId: agent.id,
				expiresAt: tomorrow()
			});
			const service = await principal('service', 'CI');
			await bindRole(db, {
				principalId: service.id,
				role: 'account-admin',
				accountId: w.accountId
			});
			const publication = {
				type: 'publication',
				definitionId: w.sreDef.id,
				publishedById: publisher.id
			} as const;

			await expectRefused(
				check({ id: agent.id, onBehalfOfId: reviewer.id }, 'definition.approve', publication),
				/approvals are human-only, so a agent cannot approve/
			);
			await expectRefused(
				check(service.id, 'definition.approve', publication),
				/approvals are human-only, so a service cannot approve/
			);
		});
	});

	describe('authorized repository writes', () => {
		/** Asserts the write is refused for lack of permission, with a reason matching `reason`. */
		async function expectDenied(
			write: Promise<unknown>,
			reason: RegExp,
			rule: StoreRule = 'access-denied'
		) {
			const error = await write.then(
				() => expect.fail('expected the write to be refused, but it succeeded'),
				(e: unknown) => e
			);
			expect(error).toBeInstanceOf(AccessDeniedError);
			expect((error as AccessDeniedError).rule).toBe(rule);
			expect((error as AccessDeniedError).reason).toMatch(reason);
		}

		async function expectMismatch(write: Promise<unknown>) {
			const error = await write.then(
				() => expect.fail('expected the write to be refused, but it succeeded'),
				(e: unknown) => e
			);
			expect(error).toBeInstanceOf(StoreRuleError);
			expect((error as StoreRuleError).rule).toBe('actor-mismatch');
		}

		it('creates namespaces for an agent within its delegation, binding the user it acts for', async () => {
			const w = await world();
			const developer = await w.holder('developer');
			const agent = await principal('agent', 'Setup bot');
			const create = (
				path: string,
				auth = { actor: { id: agent.id, onBehalfOfId: developer.id } }
			) => createNamespace(db, { accountId: w.accountId, path, createdById: agent.id }, auth);

			await expectDenied(create('acme/bots'), /has not granted/, 'namespace-create-forbidden');
			await grantDelegation(db, {
				delegatorId: developer.id,
				agentId: agent.id,
				namespaceId: w.ns.root,
				expiresAt: tomorrow()
			});
			const created = await create('acme/bots');
			expect(created.createdById).toBe(agent.id);
			const admins = await db
				.select({ principalId: roleBindings.principalId })
				.from(roleBindings)
				.where(eq(roleBindings.namespaceId, created.id));
			expect(admins).toEqual([{ principalId: developer.id }]);

			await expectMismatch(
				create('acme/other', { actor: { id: developer.id, onBehalfOfId: developer.id } })
			);
		});

		it('refuses creating a definition without write', async () => {
			const w = await world();
			const reader = await w.holder('read', { namespaceId: w.ns.eng });
			const writer = await w.holder('write', { namespaceId: w.ns.eng });
			const create = (userId: string, slug: string) =>
				createProcessDefinition(
					db,
					{ namespaceId: w.ns.sre, slug, ownerId: userId, createdById: userId },
					{ actor: { id: userId } }
				);
			await expectDenied(create(reader.id, 'runbook'), /needs write or namespace-admin/);
			expect((await create(writer.id, 'runbook')).createdById).toBe(writer.id);
		});

		it('edits drafts only with write, and for agents only within their grant', async () => {
			const w = await world();
			const reader = await w.holder('read', { namespaceId: w.ns.eng });
			const writer = await w.holder('write', { namespaceId: w.ns.eng });
			const agent = await principal('agent', 'Draft bot');
			await grantDelegation(db, {
				delegatorId: writer.id,
				agentId: agent.id,
				role: 'read',
				expiresAt: tomorrow()
			});
			const edit = (authorId: string, onBehalfOfId?: string, actor?: Actor) =>
				appendDraftRevision(
					db,
					{
						definitionId: w.sreDef.id,
						body: { title: 'draft' },
						authorId,
						...(onBehalfOfId === undefined ? {} : { onBehalfOfId })
					},
					{
						actor: actor ?? {
							id: authorId,
							...(onBehalfOfId === undefined ? {} : { onBehalfOfId })
						}
					}
				);

			await expectDenied(edit(reader.id), /cannot edit the draft of definition "incident"/);
			expect((await edit(writer.id)).revision.authorId).toBe(writer.id);
			await expectDenied(edit(agent.id, writer.id), /limited to the role read/);
			await expectMismatch(edit(agent.id, writer.id, { id: agent.id, onBehalfOfId: reader.id }));
		});

		it('checks publish permission for every edit of a living definition', async () => {
			const w = await world();
			const writer = await w.holder('write', { namespaceId: w.ns.eng });
			const living = await definition(w.ns.sre, w.owner.id, 'ward-round', 'living');
			const edit = (authorId: string) =>
				appendDraftRevision(
					db,
					{
						definitionId: living.id,
						body: { title: 'v' },
						authorId,
						publish: { schemaVersion: '1', contentHash: `sha256:${randomUUID()}` }
					},
					{ actor: { id: authorId } }
				);
			const reader = await w.holder('read', { namespaceId: w.ns.eng });
			await expectDenied(edit(reader.id), /cannot edit the draft/);
			expect((await edit(writer.id)).version?.publishedById).toBe(writer.id);
		});

		it('publishes only with write, as the recorded publisher', async () => {
			const w = await world();
			const reader = await w.holder('read', { namespaceId: w.ns.sre });
			const writer = await w.holder('write', { namespaceId: w.ns.sre });
			const publishAs = (publisherId: string, actorId = publisherId) =>
				publishVersion(
					db,
					{
						definitionId: w.sreDef.id,
						body: { title: 'Incident' },
						schemaVersion: '1',
						contentHash: `sha256:${randomUUID()}`,
						authorId: publisherId,
						publishedById: publisherId
					},
					{ actor: { id: actorId } }
				);
			await expectDenied(publishAs(reader.id), /cannot publish definition "incident"/);
			expect((await publishAs(writer.id)).version).toBe(3);
			await expectMismatch(publishAs(writer.id, reader.id));
		});

		it('retires versions only as namespace-admin', async () => {
			const w = await world();
			const writer = await w.holder('write', { namespaceId: w.ns.sre });
			const admin = await w.holder('namespace-admin', { namespaceId: w.ns.eng });
			await expectDenied(
				retireVersion(db, w.v1.id, { actor: { id: writer.id } }),
				/cannot retire versions of definition "incident".*it holds write on acme\/eng\/sre$/
			);
			expect((await retireVersion(db, w.v1.id, { actor: { id: admin.id } })).status).toBe(
				'retired'
			);
		});

		it('moves a pinned case only with write on its namespace', async () => {
			const w = await world();
			const commander = await w.holder('commander', { caseId: w.incident.id });
			const writer = await w.holder('write', { namespaceId: w.ns.root });
			const move = (moverId: string) =>
				moveCaseVersion(
					db,
					{ caseId: w.incident.id, toVersionId: w.v2.id, movedById: moverId },
					{ actor: { id: moverId } }
				);
			await expectDenied(move(commander.id), /cannot move the bound version of case "Outage"/);
			expect((await move(writer.id)).definitionVersionId).toBe(w.v2.id);
		});
	});
});
