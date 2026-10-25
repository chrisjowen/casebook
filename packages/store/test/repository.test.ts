import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDb, type Db } from '../src/client.js';
import {
	addGroupMember,
	appendDraftRevision,
	bindRole,
	createAccount,
	createCase,
	createNamespace,
	createPrincipal,
	createProcessDefinition,
	findNamespaceLineage,
	grantDelegation,
	moveCaseVersion,
	namespacePathPrefixes,
	publishVersion,
	retireVersion,
	revokeDelegation,
	StoreRuleError,
	type ChangePolicy,
	type PrincipalKind,
	type StoreRule
} from '../src/repository.js';
import {
	cases,
	caseVersionMoves,
	namespaces,
	principals,
	processDefinitions,
	roleBindings
} from '../src/schema.js';

const PG = {
	foreignKey: '23503',
	unique: '23505'
} as const;

/** Asserts the write is refused by the repository for the given rule. */
async function expectRule(write: Promise<unknown>, rule: StoreRule) {
	const error = await write.then(
		() => expect.fail(`expected rule ${rule} to refuse the write, but it succeeded`),
		(e: unknown) => e
	);
	expect(error).toBeInstanceOf(StoreRuleError);
	expect((error as StoreRuleError).rule).toBe(rule);
}

/** Asserts the write fails in the database with the given SQLSTATE (and constraint, when named). */
async function expectPgError(write: Promise<unknown>, code: string, constraint?: string) {
	const error: unknown = await write.then(
		() => expect.fail(`expected SQLSTATE ${code}, but the write succeeded`),
		(e: unknown) => e
	);
	// Drizzle wraps driver errors; the postgres-js error with the SQLSTATE is the cause.
	const pg = (error instanceof Error && error.cause ? error.cause : error) as {
		code?: string;
		constraint_name?: string;
	};
	expect(pg.code).toBe(code);
	if (constraint) expect(pg.constraint_name).toBe(constraint);
}

describe('namespacePathPrefixes', () => {
	it('lists every prefix nearest first', () => {
		expect(namespacePathPrefixes('acme/eng/sre')).toEqual(['acme/eng/sre', 'acme/eng', 'acme']);
		expect(namespacePathPrefixes('acme')).toEqual(['acme']);
	});
});

const url = inject('testDatabaseUrl');

describe.skipIf(!url)('store repository (Postgres)', () => {
	let db: Db;

	beforeAll(() => {
		db = createDb(url!);
	});
	afterAll(async () => {
		await db?.$client.end();
	});

	function principal(kind: PrincipalKind, ownerId?: string) {
		return createPrincipal(db, {
			kind,
			displayName: `${kind} ${randomUUID()}`,
			issuer: 'casebook',
			subject: randomUUID(),
			...(ownerId === undefined ? {} : { ownerId })
		});
	}

	async function account() {
		const owner = await principal('user');
		const acct = await createAccount(db, {
			slug: `a-${randomUUID()}`,
			displayName: 'Acme',
			createdById: owner.id
		});
		return { owner, accountId: acct.id };
	}

	// Each test builds its own fixtures in a fresh account so tests stay independent.
	async function namespaceTree(...relative: string[]) {
		const { owner, accountId } = await account();
		const root = 'acme';
		const byPath = new Map<string, string>();
		for (const rel of ['', ...relative]) {
			const path = rel ? `${root}/${rel}` : root;
			byPath.set(path, (await createNamespace(db, { accountId, path, createdById: owner.id })).id);
		}
		return { root, accountId, owner, id: (rel = '') => byPath.get(rel ? `${root}/${rel}` : root)! };
	}

	function definition(
		namespaceId: string,
		ownerId: string,
		slug = 'birth-registration',
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

	function publish(definitionId: string, authorId: string, body: unknown = { title: 'Birth' }) {
		return publishVersion(db, {
			definitionId,
			body,
			schemaVersion: '1',
			contentHash: `sha256:${randomUUID()}`,
			authorId,
			publishedById: authorId
		});
	}

	async function caseIn(namespaceId: string) {
		const owner = await principal('user');
		const def = await definition(namespaceId, owner.id, `case-def-${randomUUID()}`);
		const version = await publish(def.id, owner.id);
		return createCase(db, { namespaceId, definitionVersionId: version.id, title: 'Baby Tan' });
	}

	describe('namespaces', () => {
		it('derives the parent from the path', async () => {
			const tree = await namespaceTree('eng', 'eng/sre');
			const lineage = await findNamespaceLineage(db, tree.accountId, `${tree.root}/eng/sre`);
			expect(lineage.map((n) => [n.id, n.parentId])).toEqual([
				[tree.id('eng/sre'), tree.id('eng')],
				[tree.id('eng'), tree.id()],
				[tree.id(), null]
			]);
		});

		it('resolves a namespace and its existing ancestors, nearest first', async () => {
			const tree = await namespaceTree('eng', 'eng/sre', 'ops');
			// A path that does not exist yet still resolves its existing ancestors.
			const lineage = await findNamespaceLineage(db, tree.accountId, `${tree.root}/eng/sre/oncall`);
			expect(lineage.map((n) => n.path)).toEqual([
				`${tree.root}/eng/sre`,
				`${tree.root}/eng`,
				tree.root
			]);
		});

		it('refuses a namespace whose parent does not exist', async () => {
			const tree = await namespaceTree();
			const ns = (path: string) =>
				createNamespace(db, { accountId: tree.accountId, path, createdById: tree.owner.id });
			await expectRule(ns(`${tree.root}/eng/sre`), 'namespace-parent-missing');
		});

		it('refuses malformed paths', async () => {
			const { owner, accountId } = await account();
			for (const path of ['', 'acme/', '/acme', 'acme//eng', 'ac me']) {
				await expectRule(
					createNamespace(db, { accountId, path, createdById: owner.id }),
					'namespace-path-format'
				);
			}
		});

		it('makes paths unique per account', async () => {
			const tree = await namespaceTree();
			await expectPgError(
				createNamespace(db, {
					accountId: tree.accountId,
					path: tree.root,
					createdById: tree.owner.id
				}),
				PG.unique,
				'namespaces_account_path_key'
			);
			// The same path in another account is a different namespace.
			await namespaceTree();
		});

		it('keeps a child namespace in its parent account', async () => {
			const tree = await namespaceTree();
			const other = await account();
			// The parent lookup is scoped to the account, so another account cannot extend it.
			await expectRule(
				createNamespace(db, {
					accountId: other.accountId,
					path: `${tree.root}/eng`,
					createdById: other.owner.id
				}),
				'namespace-parent-missing'
			);
			await expectPgError(
				db.insert(namespaces).values({
					accountId: other.accountId,
					parentId: tree.id(),
					path: `${tree.root}/eng`,
					createdById: other.owner.id
				}),
				PG.foreignKey,
				'namespaces_parent_fk'
			);
		});
	});

	describe('principals', () => {
		it('keys principals by (issuer, subject)', async () => {
			const user = await principal('user');
			const copy = { kind: 'user', displayName: 'Copy', subject: user.subject } as const;
			await expectPgError(
				createPrincipal(db, { ...copy, issuer: user.issuer }),
				PG.unique,
				'principals_issuer_subject_key'
			);
			// The same subject under another issuer is a different principal.
			await createPrincipal(db, { ...copy, issuer: 'https://idp.example.test' });
		});

		it('lets only agents have an owner, and only a service principal can own them', async () => {
			const service = await principal('service');
			const agent = await principal('agent', service.id);
			expect(agent.ownerId).toBe(service.id);

			const user = await principal('user');
			await expectRule(principal('agent', user.id), 'principal-owner-kind');
			await expectRule(principal('user', service.id), 'principal-owner-agent-only');
		});

		it('only adds members to groups, and never a group to itself', async () => {
			const group = await principal('group');
			const subgroup = await principal('group');
			const user = await principal('user');
			await addGroupMember(db, group.id, user.id);
			await addGroupMember(db, group.id, subgroup.id);

			await expectPgError(
				addGroupMember(db, user.id, group.id),
				PG.foreignKey,
				'group_members_group_fk'
			);
			await expectRule(addGroupMember(db, group.id, group.id), 'group-member-self');
			// A group with members cannot quietly become another kind of principal.
			await expectPgError(
				db.update(principals).set({ kind: 'user' }).where(eq(principals.id, group.id)),
				PG.foreignKey
			);
		});
	});

	describe('process definitions', () => {
		it('records the creator and defaults to the governed change policy', async () => {
			const tree = await namespaceTree();
			const def = await createProcessDefinition(db, {
				namespaceId: tree.id(),
				slug: 'incident',
				ownerId: tree.owner.id,
				createdById: tree.owner.id
			});
			expect(def).toMatchObject({
				createdById: tree.owner.id,
				changePolicy: 'governed',
				publishRequiresApproval: false
			});
		});

		it('makes slugs unique per namespace and checks their format', async () => {
			const tree = await namespaceTree('eng', 'ops');
			const owner = await principal('user');
			await definition(tree.id('eng'), owner.id, 'incident');
			await definition(tree.id('ops'), owner.id, 'incident');
			await expectPgError(
				definition(tree.id('eng'), owner.id, 'incident'),
				PG.unique,
				'process_definitions_namespace_slug_key'
			);
			await expectRule(
				definition(tree.id('eng'), owner.id, 'Not A Slug'),
				'definition-slug-format'
			);
		});
	});

	describe('definition versions', () => {
		async function setup() {
			const tree = await namespaceTree();
			const author = await principal('user');
			const def = await definition(tree.id(), author.id);
			return { tree, author, def };
		}

		it('publishes numbered versions', async () => {
			const { author, def } = await setup();
			const first = await publish(def.id, author.id);
			const second = await publish(def.id, author.id);
			expect([first.version, second.version]).toEqual([1, 2]);
			expect(first).toMatchObject({ status: 'published', publishedById: author.id });
			expect(first.publishedAt).toBeInstanceOf(Date);
		});

		it('numbers concurrent publishes without gaps or clashes', async () => {
			const { author, def } = await setup();
			const versions = await Promise.all([1, 2, 3, 4].map(() => publish(def.id, author.id)));
			expect(versions.map((v) => v.version).sort()).toEqual([1, 2, 3, 4]);
		});

		it('retires a published version once, leaving its content unchanged', async () => {
			const { author, def } = await setup();
			const published = await publish(def.id, author.id);
			const retired = await retireVersion(db, published.id);
			expect(retired).toMatchObject({
				status: 'retired',
				body: published.body,
				contentHash: published.contentHash,
				version: published.version
			});
			await expectRule(retireVersion(db, published.id), 'version-not-published');
			await expectRule(retireVersion(db, randomUUID()), 'version-not-published');
		});

		it('pins new cases to published versions only', async () => {
			const { tree, author, def } = await setup();
			const published = await publish(def.id, author.id);
			const retired = await publish(def.id, author.id);
			await retireVersion(db, retired.id);

			const pinned = await createCase(db, {
				namespaceId: tree.id(),
				definitionVersionId: published.id,
				title: 'Baby Tan'
			});
			await expectRule(
				createCase(db, { namespaceId: tree.id(), definitionVersionId: retired.id, title: 'Lim' }),
				'version-retired'
			);
			await expectRule(
				createCase(db, { namespaceId: tree.id(), definitionVersionId: randomUUID(), title: 'X' }),
				'version-missing'
			);

			// Retiring a version leaves the cases already pinned to it in place.
			await retireVersion(db, published.id);
			const [still] = await db.select().from(cases).where(eq(cases.id, pinned.id));
			expect(still!.definitionVersionId).toBe(published.id);
		});

		it('keeps a definition with versions from being deleted', async () => {
			const { author, def } = await setup();
			await publish(def.id, author.id);
			await expectPgError(
				db.delete(processDefinitions).where(eq(processDefinitions.id, def.id)),
				PG.foreignKey
			);
		});
	});

	describe('draft revisions', () => {
		async function setup() {
			const tree = await namespaceTree();
			const user = await principal('user');
			const def = await definition(tree.id(), user.id);
			const revise = (authorId: string, onBehalfOfId?: string) =>
				appendDraftRevision(db, {
					definitionId: def.id,
					body: { title: 'draft' },
					authorId,
					...(onBehalfOfId === undefined ? {} : { onBehalfOfId })
				}).then((edit) => edit.revision);
			return { user, def, revise };
		}

		it('numbers user edits per definition', async () => {
			const { user, revise } = await setup();
			const first = await revise(user.id);
			const second = await revise(user.id);
			expect([first.revision, second.revision]).toEqual([1, 2]);
			expect(first).toMatchObject({ authorId: user.id, authorKind: 'user', onBehalfOfId: null });
		});

		it('records agent and service edits on behalf of a user, group or service', async () => {
			const { user, revise } = await setup();
			const agent = await principal('agent');
			const service = await principal('service');
			const group = await principal('group');
			const other = await principal('service');

			for (const [author, onBehalfOf] of [
				[agent, user],
				[agent, group],
				[agent, service],
				[service, user],
				[service, group],
				[service, other],
				// An unattended agent's owning service may record edits on its own behalf.
				[service, service]
			] as const) {
				const revision = await revise(author.id, onBehalfOf.id);
				expect(revision).toMatchObject({
					authorId: author.id,
					authorKind: author.kind,
					onBehalfOfId: onBehalfOf.id,
					onBehalfOfKind: onBehalfOf.kind
				});
			}
		});

		it('requires on_behalf_of exactly for agent and service authors', async () => {
			const { user, revise } = await setup();
			const agent = await principal('agent');
			const service = await principal('service');
			const group = await principal('group');

			await expectRule(revise(user.id, service.id), 'draft-on-behalf-of-forbidden');
			await expectRule(revise(agent.id), 'draft-on-behalf-of-required');
			await expectRule(revise(service.id), 'draft-on-behalf-of-required');
			await expectRule(revise(group.id, user.id), 'draft-author-kind');
		});

		it('never records an edit on behalf of an agent', async () => {
			const { revise } = await setup();
			const agent = await principal('agent');
			const other = await principal('agent');
			const service = await principal('service');
			await expectRule(revise(agent.id, other.id), 'draft-on-behalf-of-kind');
			await expectRule(revise(service.id, agent.id), 'draft-on-behalf-of-kind');
			await expectRule(revise(service.id, randomUUID()), 'principal-missing');
		});
	});

	describe('role bindings', () => {
		it('stores namespace and case bindings as (principal, role, scope) tuples', async () => {
			const tree = await namespaceTree('eng');
			const incident = await caseIn(tree.id('eng'));
			const user = await principal('user');

			const standing = await bindRole(db, {
				principalId: user.id,
				role: 'responder',
				accountId: tree.accountId,
				namespaceId: tree.id()
			});
			const assigned = await bindRole(db, {
				principalId: user.id,
				role: 'commander',
				accountId: tree.accountId,
				namespaceId: tree.id('eng'),
				caseId: incident.id
			});
			expect([standing.scopeType, standing.scopeId]).toEqual(['namespace', tree.id()]);
			expect([assigned.scopeType, assigned.scopeId]).toEqual(['case', incident.id]);

			await expectPgError(
				bindRole(db, {
					principalId: user.id,
					role: 'responder',
					accountId: tree.accountId,
					namespaceId: tree.id()
				}),
				PG.unique,
				'role_bindings_tuple_key'
			);
			await expectRule(
				bindRole(db, {
					principalId: user.id,
					role: '  ',
					accountId: tree.accountId,
					namespaceId: tree.id()
				}),
				'role-blank'
			);
		});

		it('ties a case binding to the case namespace', async () => {
			const tree = await namespaceTree('eng', 'ops');
			const incident = await caseIn(tree.id('eng'));
			const user = await principal('user');
			await expectPgError(
				bindRole(db, {
					principalId: user.id,
					role: 'commander',
					accountId: tree.accountId,
					namespaceId: tree.id('ops'),
					caseId: incident.id
				}),
				PG.foreignKey,
				'role_bindings_case_fk'
			);
		});

		it('resolves bindings for a case, then its namespace lineage', async () => {
			const tree = await namespaceTree('eng', 'eng/sre', 'ops');
			const incident = await caseIn(tree.id('eng/sre'));
			const other = await caseIn(tree.id('eng/sre'));
			const [commander, rootResponder, engResponder, opsResponder, otherCommander] =
				await Promise.all([1, 2, 3, 4, 5].map(() => principal('user')));
			const sre = tree.id('eng/sre');
			for (const binding of [
				{
					principalId: commander!.id,
					role: 'commander',
					accountId: tree.accountId,
					namespaceId: sre,
					caseId: incident.id
				},
				{
					principalId: otherCommander!.id,
					role: 'commander',
					accountId: tree.accountId,
					namespaceId: sre,
					caseId: other.id
				},
				{
					principalId: commander!.id,
					role: 'responder',
					accountId: tree.accountId,
					namespaceId: sre,
					caseId: incident.id
				},
				{
					principalId: rootResponder!.id,
					role: 'responder',
					accountId: tree.accountId,
					namespaceId: tree.id()
				},
				{
					principalId: engResponder!.id,
					role: 'responder',
					accountId: tree.accountId,
					namespaceId: tree.id('eng')
				},
				{
					principalId: opsResponder!.id,
					role: 'responder',
					accountId: tree.accountId,
					namespaceId: tree.id('ops')
				}
			]) {
				await bindRole(db, binding);
			}

			const caseHolders = await db
				.select({ principalId: roleBindings.principalId })
				.from(roleBindings)
				.where(and(eq(roleBindings.caseId, incident.id), eq(roleBindings.role, 'commander')));
			expect(caseHolders.map((r) => r.principalId)).toEqual([commander!.id]);

			const lineage = await findNamespaceLineage(db, tree.accountId, `${tree.root}/eng/sre`);
			const namespaceHolders = await db
				.select({ principalId: roleBindings.principalId, namespaceId: roleBindings.namespaceId })
				.from(roleBindings)
				.where(
					and(
						inArray(
							roleBindings.namespaceId,
							lineage.map((n) => n.id)
						),
						eq(roleBindings.role, 'responder'),
						isNull(roleBindings.caseId)
					)
				);
			expect(namespaceHolders).toEqual(
				expect.arrayContaining([
					{ principalId: engResponder!.id, namespaceId: tree.id('eng') },
					{ principalId: rootResponder!.id, namespaceId: tree.id() }
				])
			);
			expect(namespaceHolders).toHaveLength(2);
		});
	});

	describe('delegation grants', () => {
		const tomorrow = () => new Date(Date.now() + 86_400_000);

		it('records a scoped, expiring grant from a user to an agent, and revokes it once', async () => {
			const tree = await namespaceTree('eng');
			const incident = await caseIn(tree.id('eng'));
			const user = await principal('user');
			const agent = await principal('agent');
			const expiresAt = tomorrow();
			const grant = await grantDelegation(db, {
				delegatorId: user.id,
				agentId: agent.id,
				namespaceId: tree.id('eng'),
				caseId: incident.id,
				role: 'scribe',
				expiresAt
			});
			expect(grant).toMatchObject({ role: 'scribe', revokedAt: null, expiresAt });

			const revoked = await revokeDelegation(db, grant.id);
			expect(revoked.revokedAt).toBeInstanceOf(Date);
			await expectRule(revokeDelegation(db, grant.id), 'delegation-missing');
		});

		it('refuses grants from non-users or to non-agents', async () => {
			const user = await principal('user');
			const agent = await principal('agent');
			const expiresAt = tomorrow();
			await expectPgError(
				grantDelegation(db, { delegatorId: agent.id, agentId: agent.id, expiresAt }),
				PG.foreignKey,
				'delegation_grants_delegator_fk'
			);
			await expectPgError(
				grantDelegation(db, { delegatorId: user.id, agentId: user.id, expiresAt }),
				PG.foreignKey,
				'delegation_grants_agent_fk'
			);
		});

		it('requires a case limit to name the case namespace, a future expiry and a real role', async () => {
			const tree = await namespaceTree('eng', 'ops');
			const incident = await caseIn(tree.id('eng'));
			const user = await principal('user');
			const agent = await principal('agent');
			const base = { delegatorId: user.id, agentId: agent.id, expiresAt: tomorrow() };

			await expectRule(
				grantDelegation(db, { ...base, caseId: incident.id }),
				'delegation-case-needs-namespace'
			);
			await expectPgError(
				grantDelegation(db, { ...base, caseId: incident.id, namespaceId: tree.id('ops') }),
				PG.foreignKey,
				'delegation_grants_case_fk'
			);
			await expectRule(
				grantDelegation(db, { ...base, expiresAt: new Date(Date.now() - 1000) }),
				'delegation-expiry-past'
			);
			await expectRule(grantDelegation(db, { ...base, role: '' }), 'role-blank');
		});
	});

	describe('accounts and namespace creation', () => {
		/** A user bound to `role` at account scope. */
		async function member(accountId: string, role: string) {
			const user = await principal('user');
			await bindRole(db, { principalId: user.id, role, accountId });
			return user;
		}

		const bindingsOf = (principalId: string) =>
			db
				.select({
					role: roleBindings.role,
					scopeType: roleBindings.scopeType,
					scopeId: roleBindings.scopeId
				})
				.from(roleBindings)
				.where(eq(roleBindings.principalId, principalId));

		it('binds the creating user as account-owner', async () => {
			const { owner, accountId } = await account();
			expect(await bindingsOf(owner.id)).toEqual([
				{ role: 'account-owner', scopeType: 'account', scopeId: accountId }
			]);
		});

		it('refuses non-user creators, malformed slugs and duplicate slugs', async () => {
			const service = await principal('service');
			const user = await principal('user');
			await expectRule(
				createAccount(db, { slug: `s-${randomUUID()}`, displayName: 'S', createdById: service.id }),
				'account-creator-kind'
			);
			await expectRule(
				createAccount(db, { slug: 'Not A Slug', displayName: 'X', createdById: user.id }),
				'account-slug-format'
			);
			const slug = `dup-${randomUUID()}`;
			await createAccount(db, { slug, displayName: 'A', createdById: user.id });
			await expectPgError(
				createAccount(db, { slug, displayName: 'B', createdById: user.id }),
				PG.unique,
				'accounts_slug_key'
			);
		});

		it('lets developers and above create namespaces and makes the creator namespace-admin', async () => {
			const { owner, accountId } = await account();
			const admin = await member(accountId, 'account-admin');
			const developer = await member(accountId, 'developer');

			const root = await createNamespace(db, { accountId, path: 'acme', createdById: owner.id });
			const eng = await createNamespace(db, {
				accountId,
				path: 'acme/eng',
				createdById: developer.id
			});
			const ops = await createNamespace(db, { accountId, path: 'acme/ops', createdById: admin.id });
			expect([root.createdById, eng.createdById, ops.createdById]).toEqual([
				owner.id,
				developer.id,
				admin.id
			]);
			expect(await bindingsOf(developer.id)).toEqual(
				expect.arrayContaining([
					{ role: 'namespace-admin', scopeType: 'namespace', scopeId: eng.id }
				])
			);
		});

		it('refuses read-only members, outsiders and namespace members without admin', async () => {
			const tree = await namespaceTree('eng');
			const readOnly = await member(tree.accountId, 'read-only');
			const outsider = await principal('user');
			const writer = await principal('user');
			await bindRole(db, {
				principalId: writer.id,
				role: 'write',
				accountId: tree.accountId,
				namespaceId: tree.id('eng')
			});
			for (const creator of [readOnly, outsider, writer]) {
				await expectRule(
					createNamespace(db, {
						accountId: tree.accountId,
						path: 'acme/eng/sre',
						createdById: creator.id
					}),
					'namespace-create-forbidden'
				);
			}
		});

		it('lets namespace-admin on an ancestor create descendants, but not elsewhere', async () => {
			const tree = await namespaceTree('eng', 'ops');
			const lead = await principal('user');
			await bindRole(db, {
				principalId: lead.id,
				role: 'namespace-admin',
				accountId: tree.accountId,
				namespaceId: tree.id('eng')
			});
			const ns = (path: string) =>
				createNamespace(db, { accountId: tree.accountId, path, createdById: lead.id });

			await ns('acme/eng/sre');
			// Namespace permissions apply to descendants.
			await ns('acme/eng/sre/oncall');
			await expectRule(ns('acme/ops/billing'), 'namespace-create-forbidden');
			await expectRule(ns('beta'), 'namespace-create-forbidden');
		});

		it('honours roles held through nested groups', async () => {
			const tree = await namespaceTree('eng');
			const platform = await principal('group');
			const sre = await principal('group');
			const user = await principal('user');
			await addGroupMember(db, platform.id, sre.id);
			await addGroupMember(db, sre.id, user.id);
			await bindRole(db, {
				principalId: platform.id,
				role: 'namespace-admin',
				accountId: tree.accountId,
				namespaceId: tree.id('eng')
			});
			const created = await createNamespace(db, {
				accountId: tree.accountId,
				path: 'acme/eng/sre',
				createdById: user.id
			});
			expect(created.createdById).toBe(user.id);
		});
	});

	describe('role binding scopes', () => {
		it('takes account roles only at account scope, and namespace permissions not at case scope', async () => {
			const tree = await namespaceTree('eng');
			const incident = await caseIn(tree.id('eng'));
			const user = await principal('user');
			const bind = (role: string, scope: { namespaceId?: string; caseId?: string } = {}) =>
				bindRole(db, { principalId: user.id, role, accountId: tree.accountId, ...scope });
			const eng = { namespaceId: tree.id('eng') };
			const onCase = { ...eng, caseId: incident.id };

			await bind('developer');
			await bind('read', eng);
			await bind('incident-commander', eng);
			await bind('incident-commander', onCase);

			await expectRule(bind('write'), 'role-scope');
			await expectRule(bind('incident-commander'), 'role-scope');
			await expectRule(bind('developer', eng), 'role-scope');
			await expectRule(bind('namespace-admin', onCase), 'role-scope');
			await expectRule(bind('account-owner', onCase), 'role-scope');
			await expectRule(bind('scribe', { caseId: incident.id }), 'role-case-needs-namespace');
		});

		it('keeps a namespace binding inside its account', async () => {
			const tree = await namespaceTree();
			const other = await account();
			const user = await principal('user');
			await expectPgError(
				bindRole(db, {
					principalId: user.id,
					role: 'read',
					accountId: other.accountId,
					namespaceId: tree.id()
				}),
				PG.foreignKey,
				'role_bindings_namespace_fk'
			);
		});
	});

	describe('change policies and case binding', () => {
		const fields = () => ({ schemaVersion: '1', contentHash: `sha256:${randomUUID()}` });

		async function setup(changePolicy: ChangePolicy) {
			const tree = await namespaceTree();
			const def = await definition(tree.id(), tree.owner.id, 'ward-round', changePolicy);
			const edit = (title: string, publish = changePolicy === 'living') =>
				appendDraftRevision(db, {
					definitionId: def.id,
					body: { title },
					authorId: tree.owner.id,
					...(publish ? { publish: fields() } : {})
				});
			const newCase = (definitionVersionId: string, binding?: 'pinned' | 'follow_latest') =>
				createCase(db, {
					namespaceId: tree.id(),
					definitionVersionId,
					title: 'Patient',
					...(binding ? { binding } : {})
				});
			return { tree, def, edit, newCase };
		}

		const boundVersion = async (caseId: string) =>
			(await db.select().from(cases).where(eq(cases.id, caseId)))[0]!.definitionVersionId;

		it('publishes every edit of a living definition and moves following cases along', async () => {
			const { def, edit, newCase } = await setup('living');
			const first = await edit('v1');
			expect(first.version).toMatchObject({
				version: 1,
				status: 'published',
				body: { title: 'v1' },
				sourceRevisionId: first.revision.id
			});

			const following = await newCase(first.version!.id);
			const pinned = await newCase(first.version!.id, 'pinned');
			expect([following.binding, pinned.binding]).toEqual(['follow_latest', 'pinned']);

			const second = await edit('v2');
			expect(second.version!.version).toBe(2);
			expect(await boundVersion(following.id)).toBe(second.version!.id);
			expect(await boundVersion(pinned.id)).toBe(first.version!.id);

			await expectRule(
				publishVersion(db, {
					definitionId: def.id,
					body: {},
					...fields(),
					authorId: def.ownerId,
					publishedById: def.ownerId
				}),
				'definition-living'
			);
			await expectRule(edit('no version', false), 'edit-publish-fields');
		});

		it('keeps governed edits as drafts until an explicit publish, and pins cases by default', async () => {
			const { tree, def, edit, newCase } = await setup('governed');
			const draft = await edit('draft');
			expect(draft.version).toBeNull();
			await expectRule(edit('auto', true), 'edit-publish-fields');

			const v1 = await publishVersion(db, {
				definitionId: def.id,
				body: draft.revision.body,
				...fields(),
				authorId: tree.owner.id,
				publishedById: tree.owner.id,
				sourceRevisionId: draft.revision.id
			});
			const pinned = await newCase(v1.id);
			const following = await newCase(v1.id, 'follow_latest');
			expect([pinned.binding, following.binding]).toEqual(['pinned', 'follow_latest']);

			const v2 = await publish(def.id, tree.owner.id);
			expect(await boundVersion(pinned.id)).toBe(v1.id);
			expect(await boundVersion(following.id)).toBe(v2.id);

			const other = await definition(tree.id(), tree.owner.id, 'other');
			const foreign = await appendDraftRevision(db, {
				definitionId: other.id,
				body: {},
				authorId: tree.owner.id
			});
			await expectRule(
				publishVersion(db, {
					definitionId: def.id,
					body: {},
					...fields(),
					authorId: tree.owner.id,
					publishedById: tree.owner.id,
					sourceRevisionId: foreign.revision.id
				}),
				'revision-other-definition'
			);
		});

		it('publishes a draft revision with its own body, or an explicit body without provenance', async () => {
			const { tree, def, edit } = await setup('governed');
			const draft = await edit('draft');
			const base = {
				definitionId: def.id,
				authorId: tree.owner.id,
				publishedById: tree.owner.id
			};

			const fromRevision = await publishVersion(db, {
				...base,
				...fields(),
				sourceRevisionId: draft.revision.id
			});
			expect(fromRevision).toMatchObject({
				body: { title: 'draft' },
				sourceRevisionId: draft.revision.id
			});
			await expectRule(
				publishVersion(db, {
					...base,
					...fields(),
					body: { title: 'something else' },
					sourceRevisionId: draft.revision.id
				}),
				'publish-body-mismatch'
			);

			const explicit = await publishVersion(db, { ...base, ...fields(), body: { title: 'direct' } });
			expect(explicit).toMatchObject({ body: { title: 'direct' }, sourceRevisionId: null });
			await expectRule(publishVersion(db, { ...base, ...fields() }), 'publish-body-missing');
		});

		it('binds a case only in the definition namespace or its descendants, within the account', async () => {
			const tree = await namespaceTree('eng', 'eng/sre', 'ops');
			const def = await definition(tree.id('eng'), tree.owner.id);
			const v1 = await publish(def.id, tree.owner.id);
			const v2 = await publish(def.id, tree.owner.id);
			const other = await namespaceTree();
			const caseAt = (namespaceId: string) =>
				createCase(db, { namespaceId, definitionVersionId: v1.id, title: 'Outage' });

			await caseAt(tree.id('eng'));
			const descendant = await caseAt(tree.id('eng/sre'));
			const moved = await moveCaseVersion(db, {
				caseId: descendant.id,
				toVersionId: v2.id,
				movedById: tree.owner.id
			});
			expect(moved.definitionVersionId).toBe(v2.id);

			await expectRule(caseAt(tree.id('ops')), 'case-namespace-outside-definition');
			await expectRule(caseAt(tree.id()), 'case-namespace-outside-definition');
			await expectRule(caseAt(other.id()), 'case-namespace-outside-definition');
		});

		it('moves a following case created during a concurrent publish', async () => {
			const { tree, def, newCase } = await setup('governed');
			const v1 = await publish(def.id, tree.owner.id);
			let publishing: Promise<{ id: string }> | undefined;
			const following = await db.transaction(async (tx) => {
				const created = await createCase(tx as unknown as Db, {
					namespaceId: tree.id(),
					definitionVersionId: v1.id,
					title: 'Patient',
					binding: 'follow_latest'
				});
				publishing = publish(def.id, tree.owner.id);
				await new Promise((resolve) => setTimeout(resolve, 200));
				return created;
			});
			const v2 = await publishing!;
			expect(await boundVersion(following.id)).toBe(v2.id);
			await expectRule(newCase(v1.id, 'follow_latest'), 'case-follow-needs-latest');
		});

		it('starts a following case on the latest version only', async () => {
			const { tree, def, newCase } = await setup('governed');
			const v1 = await publish(def.id, tree.owner.id);
			await publish(def.id, tree.owner.id);
			await expectRule(newCase(v1.id, 'follow_latest'), 'case-follow-needs-latest');
			await newCase(v1.id, 'pinned');
		});

		it('moves a pinned case forward only by an explicit, recorded move', async () => {
			const { tree, def, newCase } = await setup('governed');
			const mover = await principal('user');
			const v1 = await publish(def.id, tree.owner.id);
			const v2 = await publish(def.id, tree.owner.id);
			const v3 = await publish(def.id, tree.owner.id);
			await retireVersion(db, v3.id);
			const pinned = await newCase(v1.id);
			const move = (caseId: string, toVersionId: string) =>
				moveCaseVersion(db, { caseId, toVersionId, movedById: mover.id });

			const moved = await move(pinned.id, v2.id);
			expect(moved.definitionVersionId).toBe(v2.id);
			const audit = await db
				.select()
				.from(caseVersionMoves)
				.where(eq(caseVersionMoves.caseId, pinned.id));
			expect(audit).toMatchObject([
				{ fromVersionId: v1.id, toVersionId: v2.id, movedById: mover.id }
			]);
			expect(audit[0]!.movedAt).toBeInstanceOf(Date);

			await expectRule(move(pinned.id, v1.id), 'case-move-not-newer');
			await expectRule(move(pinned.id, v3.id), 'version-retired');
			const other = await definition(tree.id(), tree.owner.id, 'other');
			await expectRule(
				move(pinned.id, (await publish(other.id, tree.owner.id)).id),
				'case-move-other-definition'
			);
			await expectRule(move(randomUUID(), v2.id), 'case-missing');

			const following = await newCase(v2.id, 'follow_latest');
			await expectRule(move(following.id, v2.id), 'case-move-not-pinned');
		});
	});
});
