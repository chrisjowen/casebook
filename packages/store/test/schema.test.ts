import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDb, type Db } from '../src/client.js';
import { findNamespaceLineage, namespacePathPrefixes } from '../src/namespaces.js';
import {
	cases,
	definitionVersions,
	delegationGrants,
	draftRevisions,
	groupMembers,
	namespaces,
	principals,
	processDefinitions,
	roleBindings
} from '../src/schema.js';

const PG = {
	foreignKey: '23503',
	unique: '23505',
	check: '23514'
} as const;

/** Asserts the query fails with the given Postgres SQLSTATE (and constraint, when named). */
async function expectPgError(query: PromiseLike<unknown>, code: string, constraint?: string) {
	const error: unknown = await Promise.resolve(query).then(
		() => expect.fail(`expected SQLSTATE ${code}, but the query succeeded`),
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

describe.skipIf(!url)('store schema (Postgres)', () => {
	let db: Db;

	beforeAll(() => {
		db = createDb(url!);
	});
	afterAll(async () => {
		await db?.$client.end();
	});

	// Each test builds its own fixtures under a unique root so tests stay independent.
	async function namespaceTree(...relative: string[]) {
		const root = `t-${randomUUID()}`;
		const byPath = new Map<string, string>();
		for (const rel of ['', ...relative]) {
			const path = rel ? `${root}/${rel}` : root;
			const parentPath = rel ? path.slice(0, path.lastIndexOf('/')) : null;
			const [row] = await db
				.insert(namespaces)
				.values({ path, parentId: parentPath ? byPath.get(parentPath)! : null })
				.returning();
			byPath.set(path, row!.id);
		}
		return { root, id: (rel = '') => byPath.get(rel ? `${root}/${rel}` : root)! };
	}

	async function principal(
		kind: 'user' | 'group' | 'agent' | 'service',
		extra: Partial<typeof principals.$inferInsert> = {}
	) {
		const [row] = await db
			.insert(principals)
			.values({
				kind,
				displayName: `${kind} ${randomUUID()}`,
				issuer: 'casebook',
				subject: randomUUID(),
				...extra
			})
			.returning();
		return row!;
	}

	async function definition(namespaceId: string, ownerId: string, slug = 'birth-registration') {
		const [row] = await db
			.insert(processDefinitions)
			.values({ namespaceId, slug, ownerId })
			.returning();
		return row!;
	}

	async function draftVersion(definitionId: string, authorId: string, version = 1) {
		const [row] = await db
			.insert(definitionVersions)
			.values({
				definitionId,
				version,
				body: { title: 'Birth registration', nodes: [] },
				schemaVersion: '1',
				contentHash: `sha256:${randomUUID()}`,
				authorId
			})
			.returning();
		return row!;
	}

	async function publishedVersion(definitionId: string, authorId: string, version = 1) {
		const draft = await draftVersion(definitionId, authorId, version);
		const [row] = await db
			.update(definitionVersions)
			.set({ status: 'published', publishedById: authorId, publishedAt: new Date() })
			.where(eq(definitionVersions.id, draft.id))
			.returning();
		return row!;
	}

	async function caseIn(namespaceId: string) {
		const owner = await principal('user');
		const def = await definition(namespaceId, owner.id, `case-def-${Date.now()}`);
		const version = await publishedVersion(def.id, owner.id);
		const [row] = await db
			.insert(cases)
			.values({ namespaceId, definitionVersionId: version.id, title: 'Baby Tan' })
			.returning();
		return row!;
	}

	describe('namespaces', () => {
		it('resolves a namespace and its existing ancestors, nearest first', async () => {
			const tree = await namespaceTree('eng', 'eng/sre', 'ops');
			const lineage = await findNamespaceLineage(db, `${tree.root}/eng/sre`);
			expect(lineage.map((n) => n.id)).toEqual([tree.id('eng/sre'), tree.id('eng'), tree.id()]);

			// A path that does not exist yet still resolves its existing ancestors.
			const missing = await findNamespaceLineage(db, `${tree.root}/eng/sre/oncall`);
			expect(missing.map((n) => n.path)).toEqual([
				`${tree.root}/eng/sre`,
				`${tree.root}/eng`,
				tree.root
			]);
		});

		it('refuses duplicate paths', async () => {
			const tree = await namespaceTree();
			await expectPgError(
				db.insert(namespaces).values({ path: tree.root }),
				PG.unique,
				'namespaces_path_key'
			);
		});

		it('refuses a path that does not extend its parent by one segment', async () => {
			const tree = await namespaceTree('eng');
			await expectPgError(
				db.insert(namespaces).values({ path: `other/sre`, parentId: tree.id('eng') }),
				PG.check
			);
			await expectPgError(
				db.insert(namespaces).values({ path: `${tree.root}/eng/a/b`, parentId: tree.id('eng') }),
				PG.check
			);
			await expectPgError(db.insert(namespaces).values({ path: `${tree.root}/orphan` }), PG.check);
		});

		it('refuses malformed paths', async () => {
			for (const path of ['', 'acme/', '/acme', 'acme//eng', 'ac me']) {
				// The path trigger can refuse some of these before the format check runs.
				await expectPgError(db.insert(namespaces).values({ path }), PG.check);
			}
		});

		it('refuses moving or renaming a namespace', async () => {
			const tree = await namespaceTree('eng', 'ops');
			await expectPgError(
				db
					.update(namespaces)
					.set({ path: `${tree.root}/platform` })
					.where(eq(namespaces.id, tree.id('eng'))),
				PG.check
			);
			await expectPgError(
				db
					.update(namespaces)
					.set({ parentId: tree.id('ops') })
					.where(eq(namespaces.id, tree.id('eng'))),
				PG.check
			);
		});
	});

	describe('principals', () => {
		it('keys principals by (issuer, subject)', async () => {
			const user = await principal('user');
			await expectPgError(
				db.insert(principals).values({
					kind: 'user',
					displayName: 'Copy',
					issuer: user.issuer,
					subject: user.subject
				}),
				PG.unique,
				'principals_issuer_subject_key'
			);
			// The same subject under another issuer is a different principal.
			await principal('user', { issuer: 'https://idp.example.test', subject: user.subject });
		});

		it('lets only agents have an owner, and only a service principal can own them', async () => {
			const service = await principal('service');
			const agent = await principal('agent', { ownerId: service.id });
			expect(agent.ownerId).toBe(service.id);

			const user = await principal('user');
			await expectPgError(
				principal('agent', { ownerId: user.id }),
				PG.foreignKey,
				'principals_owner_fk'
			);
			await expectPgError(
				principal('user', { ownerId: service.id }),
				PG.check,
				'principals_owner_agent_only'
			);
		});

		it('only adds members to groups', async () => {
			const group = await principal('group');
			const subgroup = await principal('group');
			const user = await principal('user');
			await db.insert(groupMembers).values([
				{ groupId: group.id, memberId: user.id },
				{ groupId: group.id, memberId: subgroup.id }
			]);

			await expectPgError(
				db.insert(groupMembers).values({ groupId: user.id, memberId: group.id }),
				PG.foreignKey,
				'group_members_group_fk'
			);
			await expectPgError(
				db.insert(groupMembers).values({ groupId: group.id, memberId: group.id }),
				PG.check,
				'group_members_not_self'
			);
			// A group with members cannot quietly become another kind of principal.
			await expectPgError(
				db.update(principals).set({ kind: 'user' }).where(eq(principals.id, group.id)),
				PG.foreignKey
			);
		});
	});

	describe('role bindings', () => {
		it('stores namespace and case bindings as (principal, role, scope) tuples', async () => {
			const tree = await namespaceTree('eng');
			const incident = await caseIn(tree.id('eng'));
			const user = await principal('user');

			const rows = await db
				.insert(roleBindings)
				.values([
					{ principalId: user.id, role: 'responder', namespaceId: tree.id() },
					{
						principalId: user.id,
						role: 'commander',
						namespaceId: tree.id('eng'),
						caseId: incident.id
					}
				])
				.returning();
			expect(rows.map((r) => [r.role, r.scopeType, r.scopeId])).toEqual([
				['responder', 'namespace', tree.id()],
				['commander', 'case', incident.id]
			]);

			await expectPgError(
				db
					.insert(roleBindings)
					.values({ principalId: user.id, role: 'responder', namespaceId: tree.id() }),
				PG.unique,
				'role_bindings_tuple_key'
			);
		});

		it('ties a case binding to the case namespace', async () => {
			const tree = await namespaceTree('eng', 'ops');
			const incident = await caseIn(tree.id('eng'));
			const user = await principal('user');
			await expectPgError(
				db.insert(roleBindings).values({
					principalId: user.id,
					role: 'commander',
					namespaceId: tree.id('ops'),
					caseId: incident.id
				}),
				PG.foreignKey,
				'role_bindings_case_fk'
			);
		});

		it('has indexes for case-first then namespace-lineage resolution', async () => {
			const rows = await db.execute<{ indexname: string; indexdef: string }>(
				sql`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'role_bindings' ORDER BY indexname`
			);
			const defs = Object.fromEntries(rows.map((r) => [r.indexname, r.indexdef]));
			expect(defs['role_bindings_case_role_idx']).toMatch(
				/\(case_id, role\) WHERE \(case_id IS NOT NULL\)/
			);
			expect(defs['role_bindings_namespace_role_idx']).toMatch(
				/\(namespace_id, role\) WHERE \(case_id IS NULL\)/
			);
		});
	});

	describe('delegation grants', () => {
		it('records a scoped, expiring grant from a user to an agent', async () => {
			const tree = await namespaceTree('eng');
			const incident = await caseIn(tree.id('eng'));
			const user = await principal('user');
			const agent = await principal('agent');
			const expiresAt = new Date(Date.now() + 86_400_000);
			const [grant] = await db
				.insert(delegationGrants)
				.values({
					delegatorId: user.id,
					agentId: agent.id,
					namespaceId: tree.id('eng'),
					caseId: incident.id,
					role: 'scribe',
					expiresAt
				})
				.returning();
			expect(grant).toMatchObject({ role: 'scribe', revokedAt: null, expiresAt });
		});

		it('refuses grants from non-users or to non-agents', async () => {
			const user = await principal('user');
			const agent = await principal('agent');
			const expiresAt = new Date(Date.now() + 86_400_000);
			await expectPgError(
				db.insert(delegationGrants).values({ delegatorId: agent.id, agentId: agent.id, expiresAt }),
				PG.foreignKey,
				'delegation_grants_delegator_fk'
			);
			await expectPgError(
				db.insert(delegationGrants).values({ delegatorId: user.id, agentId: user.id, expiresAt }),
				PG.foreignKey,
				'delegation_grants_agent_fk'
			);
		});

		it('requires a case limit to name the case namespace, and expiry after creation', async () => {
			const tree = await namespaceTree('eng', 'ops');
			const incident = await caseIn(tree.id('eng'));
			const user = await principal('user');
			const agent = await principal('agent');
			const base = {
				delegatorId: user.id,
				agentId: agent.id,
				expiresAt: new Date(Date.now() + 86_400_000)
			};

			await expectPgError(
				db.insert(delegationGrants).values({ ...base, caseId: incident.id }),
				PG.check,
				'delegation_grants_case_has_namespace'
			);
			await expectPgError(
				db
					.insert(delegationGrants)
					.values({ ...base, caseId: incident.id, namespaceId: tree.id('ops') }),
				PG.foreignKey,
				'delegation_grants_case_fk'
			);
			await expectPgError(
				db.insert(delegationGrants).values({ ...base, expiresAt: new Date(Date.now() - 1000) }),
				PG.check,
				'delegation_grants_expires_after_created'
			);
		});
	});

	describe('process definitions', () => {
		it('makes slugs unique per namespace', async () => {
			const tree = await namespaceTree('eng', 'ops');
			const owner = await principal('user');
			await definition(tree.id('eng'), owner.id, 'incident');
			await definition(tree.id('ops'), owner.id, 'incident');
			await expectPgError(
				definition(tree.id('eng'), owner.id, 'incident'),
				PG.unique,
				'process_definitions_namespace_slug_key'
			);
			await expectPgError(
				definition(tree.id('eng'), owner.id, 'Not A Slug'),
				PG.check,
				'process_definitions_slug_format'
			);
		});
	});

	describe('definition versions', () => {
		async function setup() {
			const tree = await namespaceTree();
			const author = await principal('user');
			const def = await definition(tree.id(), author.id);
			return { author, def };
		}

		it('lets drafts change and be deleted', async () => {
			const { author, def } = await setup();
			const draft = await draftVersion(def.id, author.id);
			const [edited] = await db
				.update(definitionVersions)
				.set({ body: { title: 'Edited' } })
				.where(eq(definitionVersions.id, draft.id))
				.returning();
			expect(edited!.body).toEqual({ title: 'Edited' });
			await db.delete(definitionVersions).where(eq(definitionVersions.id, draft.id));
		});

		it('requires publish fields exactly when published', async () => {
			const { author, def } = await setup();
			const draft = await draftVersion(def.id, author.id);
			await expectPgError(
				db
					.update(definitionVersions)
					.set({ status: 'published' })
					.where(eq(definitionVersions.id, draft.id)),
				PG.check,
				'definition_versions_publish_fields'
			);
			await expectPgError(
				db
					.update(definitionVersions)
					.set({ publishedAt: new Date() })
					.where(eq(definitionVersions.id, draft.id)),
				PG.check,
				'definition_versions_publish_fields'
			);
		});

		it('refuses any change to a published version', async () => {
			const { author, def } = await setup();
			const published = await publishedVersion(def.id, author.id);
			const byId = eq(definitionVersions.id, published.id);
			const other = await principal('user');

			await expectPgError(
				db
					.update(definitionVersions)
					.set({ body: { title: 'Sneaky' } })
					.where(byId),
				PG.check
			);
			await expectPgError(
				db.update(definitionVersions).set({ contentHash: 'sha256:x' }).where(byId),
				PG.check
			);
			await expectPgError(
				db.update(definitionVersions).set({ publishedById: other.id }).where(byId),
				PG.check
			);
			await expectPgError(db.update(definitionVersions).set({ version: 2 }).where(byId), PG.check);
			await expectPgError(
				db
					.update(definitionVersions)
					.set({ status: 'draft', publishedById: null, publishedAt: null })
					.where(byId),
				PG.check
			);
			await expectPgError(db.delete(definitionVersions).where(byId), PG.check);

			const [row] = await db.select().from(definitionVersions).where(byId);
			expect(row!.body).toEqual(published.body);
		});

		it('lets a published version be retired, after which it is frozen', async () => {
			const { author, def } = await setup();
			const published = await publishedVersion(def.id, author.id);
			const byId = eq(definitionVersions.id, published.id);

			const [retired] = await db
				.update(definitionVersions)
				.set({ status: 'retired' })
				.where(byId)
				.returning();
			expect(retired!.status).toBe('retired');

			await expectPgError(
				db.update(definitionVersions).set({ status: 'published' }).where(byId),
				PG.check
			);
			await expectPgError(db.update(definitionVersions).set({ body: {} }).where(byId), PG.check);
			await expectPgError(db.delete(definitionVersions).where(byId), PG.check);
		});

		it('refuses retiring a draft and duplicate version numbers', async () => {
			const { author, def } = await setup();
			const draft = await draftVersion(def.id, author.id);
			await expectPgError(
				db
					.update(definitionVersions)
					.set({ status: 'retired', publishedById: author.id, publishedAt: new Date() })
					.where(eq(definitionVersions.id, draft.id)),
				PG.check
			);
			await expectPgError(
				draftVersion(def.id, author.id, 1),
				PG.unique,
				'definition_versions_definition_version_key'
			);
		});

		it('keeps a definition with versions from being deleted', async () => {
			const { author, def } = await setup();
			await publishedVersion(def.id, author.id);
			await expectPgError(
				db.delete(processDefinitions).where(eq(processDefinitions.id, def.id)),
				PG.foreignKey
			);
		});
	});

	describe('draft revisions', () => {
		it('records agent edits on behalf of a user, numbered per definition', async () => {
			const tree = await namespaceTree();
			const user = await principal('user');
			const agent = await principal('agent');
			const def = await definition(tree.id(), user.id);

			const [revision] = await db
				.insert(draftRevisions)
				.values({
					definitionId: def.id,
					revision: 1,
					body: { title: 'v1' },
					authorId: agent.id,
					onBehalfOfId: user.id
				})
				.returning();
			expect(revision).toMatchObject({ authorId: agent.id, onBehalfOfId: user.id });

			await expectPgError(
				db
					.insert(draftRevisions)
					.values({ definitionId: def.id, revision: 1, body: {}, authorId: user.id }),
				PG.unique,
				'draft_revisions_definition_revision_key'
			);
			await expectPgError(
				db.insert(draftRevisions).values({
					definitionId: def.id,
					revision: 2,
					body: {},
					authorId: user.id,
					onBehalfOfId: user.id
				}),
				PG.check,
				'draft_revisions_on_behalf_of_other'
			);
		});
	});
});
