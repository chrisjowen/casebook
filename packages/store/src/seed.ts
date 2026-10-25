// Demo data for local development: one account, a namespace tree, four users with different
// access, and the model's synthetic fixtures (ADR 0014) as published definitions. The users sign
// in through the web app's dev sign-in, which has no passwords.
import { eq } from 'drizzle-orm';
import type { DefinitionDocument } from '@casebook/model';
import { birthRegistrationAbroad, incidentManagement } from '@casebook/model/fixtures';
import type { Db } from './client.js';
import { contentHash } from './definitions.js';
import {
	appendDraftRevision,
	bindRole,
	createAccount,
	createNamespace,
	createPrincipal,
	createProcessDefinition,
	publishVersion,
	type ChangePolicy,
	type Principal
} from './repository.js';
import { accounts } from './schema.js';

/** The issuer of the demo users, which only the dev sign-in accepts. */
export const DEMO_ISSUER = 'casebook-dev';

/** The slug of the demo account. The seed does nothing when it already exists. */
export const DEMO_ACCOUNT = 'acme';

const NAMESPACES = [
	'acme',
	'acme/eng',
	'acme/eng/sre',
	'personal',
	'personal/example-user',
	'personal/example-user/family'
];

const DEFINITIONS: { document: DefinitionDocument; changePolicy: ChangePolicy }[] = [
	{ document: incidentManagement, changePolicy: 'governed' },
	{ document: birthRegistrationAbroad, changePolicy: 'living' }
];

export interface Seeded {
	/** False when the demo account already existed, so nothing was written. */
	seeded: boolean;
	users: Principal[];
}

/**
 * Loads the demo data, unless the demo account already exists:
 *
 * - Olive Owner, account-owner of `acme`, who creates the namespaces and owns the definitions;
 * - Devon Developer, developer in the account, who creates `acme/eng/platform` and so is its
 *   namespace-admin;
 * - Wren Writer, read-only in the account with write on `acme/eng`;
 * - Rae Reader, read-only in the account.
 *
 * Incident management is published as a governed definition and birth registration abroad as a
 * living one, each from a first draft revision.
 */
export async function seedDemo(db: Db): Promise<Seeded> {
	const [existing] = await db
		.select({ id: accounts.id })
		.from(accounts)
		.where(eq(accounts.slug, DEMO_ACCOUNT));
	if (existing) return { seeded: false, users: [] };

	const user = (displayName: string, subject: string) =>
		createPrincipal(db, { kind: 'user', displayName, issuer: DEMO_ISSUER, subject });
	const olive = await user('Olive Owner', 'olive');
	const devon = await user('Devon Developer', 'devon');
	const wren = await user('Wren Writer', 'wren');
	const rae = await user('Rae Reader', 'rae');

	const account = await createAccount(db, {
		slug: DEMO_ACCOUNT,
		displayName: 'Acme',
		createdById: olive.id
	});
	const accountId = account.id;
	const namespaceIds = new Map<string, string>();
	for (const path of NAMESPACES) {
		const namespace = await createNamespace(db, { accountId, path, createdById: olive.id });
		namespaceIds.set(path, namespace.id);
	}

	await bindRole(db, { principalId: devon.id, role: 'developer', accountId });
	await bindRole(db, { principalId: wren.id, role: 'read-only', accountId });
	await bindRole(db, {
		principalId: wren.id,
		role: 'write',
		accountId,
		namespaceId: namespaceIds.get('acme/eng')!
	});
	await bindRole(db, { principalId: rae.id, role: 'read-only', accountId });
	await createNamespace(
		db,
		{ accountId, path: 'acme/eng/platform', createdById: devon.id },
		{ actor: { id: devon.id } }
	);

	for (const { document, changePolicy } of DEFINITIONS) {
		const auth = { actor: { id: olive.id } };
		const definition = await createProcessDefinition(
			db,
			{
				namespaceId: namespaceIds.get(document.namespace)!,
				slug: document.slug,
				ownerId: olive.id,
				createdById: olive.id,
				changePolicy
			},
			auth
		);
		const fields = {
			schemaVersion: String(document.schemaVersion),
			contentHash: contentHash(document)
		};
		const { revision } = await appendDraftRevision(
			db,
			{
				definitionId: definition.id,
				body: document,
				authorId: olive.id,
				...(changePolicy === 'living' ? { publish: fields } : {})
			},
			auth
		);
		if (changePolicy === 'governed') {
			await publishVersion(
				db,
				{
					definitionId: definition.id,
					sourceRevisionId: revision.id,
					authorId: olive.id,
					publishedById: olive.id,
					...fields
				},
				auth
			);
		}
	}

	return { seeded: true, users: [olive, devon, wren, rae] };
}
