// Demo data for local development: two accounts, their namespaces, demo users with different
// access, the model's synthetic fixtures (ADR 0014) as published definitions, and a handful of
// cases part-way through their processes. The users sign in through the web app's dev sign-in,
// which has no passwords. Everything is made up.
import { eq } from 'drizzle-orm';
import type { DefinitionDocument } from '@casebook/model';
import {
	birthRegistrationAbroad,
	incidentManagement,
	medicalBillClaim,
	spouseCitizenship
} from '@casebook/model/fixtures';
import type { Actor } from './authz.js';
import type { Db } from './client.js';
import { contentHash, editDefinition } from './definitions.js';
import { memoryFileStore, type FileStore } from './files.js';
import { createSharedLookup } from './lookups.js';
import {
	appendDraftRevision,
	bindRole,
	createAccount,
	createNamespace,
	createPrincipal,
	createProcessDefinition,
	grantDelegation,
	publishVersion,
	type ChangePolicy,
	type Principal
} from './repository.js';
import {
	completeItem,
	askQuestion,
	holdItem,
	startCase,
	startItem,
	type RuntimeRefusal,
	type Upload
} from './runtime/actions.js';
import { accounts } from './schema.js';

/** The issuer of the demo users, which only the dev sign-in accepts. */
export const DEMO_ISSUER = 'casebook-dev';

/** The slug of the demo account. The seed does nothing when it already exists. */
export const DEMO_ACCOUNT = 'acme';

/** The slug of the second demo account, a family's personal casebook. */
export const DEMO_FAMILY_ACCOUNT = 'example-family';

const ACME_NAMESPACES = ['acme', 'acme/eng', 'acme/eng/sre'];
const FAMILY_NAMESPACES = ['personal', 'personal/example-user', 'personal/example-user/family'];

/** Acme's services: what an incident's affected services are chosen from. */
const SERVICES = [
	['api', 'Public API', 'API'],
	['auth-proxy', 'Sign-in proxy', 'AUTH'],
	['checkout-api', 'Checkout API', 'CHK'],
	['payments-gateway', 'Payments gateway', 'PAY'],
	['search-indexer', 'Search indexer', 'SRCH'],
	['status-page', 'Status page', 'STAT']
] as const;

/** The ISO 3166-1 alpha-2 codes, each read in English with `Intl.DisplayNames`. */
const COUNTRY_CODES =
	'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW';

/** Every country, stored by its English name with its code, A to Z. */
function countries() {
	const names = new Intl.DisplayNames(['en'], { type: 'region' });
	return COUNTRY_CODES.split(' ')
		.map((code) => ({ value: names.of(code) ?? code, code }))
		.sort((a, b) => a.value.localeCompare(b.value, 'en'));
}

const DEFINITIONS: {
	account: 'acme' | 'family';
	document: DefinitionDocument;
	changePolicy: ChangePolicy;
}[] = [
	{ account: 'acme', document: incidentManagement, changePolicy: 'governed' },
	{ account: 'family', document: birthRegistrationAbroad, changePolicy: 'living' },
	{ account: 'family', document: spouseCitizenship, changePolicy: 'governed' },
	{ account: 'family', document: medicalBillClaim, changePolicy: 'living' }
];

export interface Seeded {
	/** False when the demo account already existed, so nothing was written. */
	seeded: boolean;
	users: Principal[];
}

export interface SeedOptions {
	/** Where the demo cases' files go; defaults to memory, for when nobody will open them. */
	files?: FileStore;
	/** The time the demo history is laid out back from; defaults to now. */
	now?: Date;
}

/**
 * Loads the demo data, unless the demo account already exists.
 *
 * Account `acme` ("Acme"):
 * - Olive Owner, account-owner, who creates the namespaces and owns the definitions; the
 *   engineering director who signs off RCAs;
 * - Devon Developer, developer, who creates `acme/eng/platform` and so is its namespace-admin;
 *   the on-call engineer and a service owner;
 * - Wren Writer, read-only with write on `acme/eng`; the incident commander;
 * - Rae Reader, read-only;
 * - Alex Example, read-only; the communications lead.
 *
 * Account `example-family` ("Example family"): Alex Example, its owner, and Sam Example, a
 * developer. Dana Cole of Riverside Hospital and Example Health Insurance are guests: they hold a
 * role on a case or in a namespace but are not members, so they see only their own forms.
 *
 * Incident management is governed; birth registration and medical bill claims are living; spouse
 * citizenship is governed, with a draft change waiting to be published. Five cases sit in
 * different stages, so each user's work shows ready, paused, waiting and repeating tasks.
 */
export async function seedDemo(db: Db, options: SeedOptions = {}): Promise<Seeded> {
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
	const alex = await user('Alex Example', 'alex');
	const sam = await user('Sam Example', 'sam');
	const dana = await user('Dana Cole', 'dana');
	const insurer = await user('Example Health Insurance', 'insurer');
	const agent = await createPrincipal(db, {
		kind: 'agent',
		displayName: 'Casebook agent',
		issuer: DEMO_ISSUER,
		subject: 'agent'
	});

	// Accounts and namespaces
	const acme = await createAccount(db, {
		slug: DEMO_ACCOUNT,
		displayName: 'Acme',
		createdById: olive.id
	});
	const family = await createAccount(db, {
		slug: DEMO_FAMILY_ACCOUNT,
		displayName: 'Example family',
		createdById: alex.id
	});
	const ns = new Map<string, string>();
	for (const path of ACME_NAMESPACES) {
		ns.set(
			path,
			(await createNamespace(db, { accountId: acme.id, path, createdById: olive.id })).id
		);
	}
	for (const path of FAMILY_NAMESPACES) {
		ns.set(
			path,
			(await createNamespace(db, { accountId: family.id, path, createdById: alex.id })).id
		);
	}
	const sre = ns.get('acme/eng/sre')!;
	const home = ns.get('personal/example-user/family')!;

	const bind = (principalId: string, role: string, accountId: string, namespaceId?: string) =>
		bindRole(db, { principalId, role, accountId, ...(namespaceId ? { namespaceId } : {}) });
	await bind(devon.id, 'developer', acme.id);
	await bind(wren.id, 'read-only', acme.id);
	await bind(wren.id, 'write', acme.id, ns.get('acme/eng'));
	await bind(rae.id, 'read-only', acme.id);
	await bind(alex.id, 'read-only', acme.id);
	await createNamespace(
		db,
		{ accountId: acme.id, path: 'acme/eng/platform', createdById: devon.id },
		{ actor: { id: devon.id } }
	);
	await bind(sam.id, 'developer', family.id);

	// Standing process roles (ADR 0008)
	await bind(olive.id, 'role.engineering-director', acme.id, sre);
	await bind(devon.id, 'role.on-call-engineer', acme.id, sre);
	await bind(devon.id, 'role.service-owner', acme.id, sre);
	await bind(wren.id, 'role.incident-commander', acme.id, sre);
	await bind(alex.id, 'role.communications-lead', acme.id, sre);
	await bind(insurer.id, 'role.insurer', family.id, home);

	// Shared lookups (ADR 0025), which the fixtures' countries and services are chosen from.
	await createSharedLookup(
		db,
		{ id: olive.id },
		{
			namespaceId: ns.get('acme/eng')!,
			title: 'Service catalog',
			values: SERVICES.map(([value, label, code]) => ({ value, label, code }))
		}
	);
	await createSharedLookup(
		db,
		{ id: alex.id },
		{
			namespaceId: ns.get('personal/example-user')!,
			title: 'ISO 3166 countries',
			values: countries()
		}
	);

	// Definitions
	const definitions = new Map<string, string>();
	for (const { account, document, changePolicy } of DEFINITIONS) {
		const owner = account === 'acme' ? olive : alex;
		const auth = { actor: { id: owner.id } };
		const definition = await createProcessDefinition(
			db,
			{
				namespaceId: ns.get(document.namespace)!,
				slug: document.slug,
				ownerId: owner.id,
				createdById: owner.id,
				changePolicy
			},
			auth
		);
		definitions.set(document.slug, definition.id);
		const fields = {
			schemaVersion: String(document.schemaVersion),
			contentHash: contentHash(document)
		};
		const { revision } = await appendDraftRevision(
			db,
			{
				definitionId: definition.id,
				body: document,
				authorId: owner.id,
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
					authorId: owner.id,
					publishedById: owner.id,
					...fields
				},
				auth
			);
		}
	}
	// A change to spouse citizenship waits in its draft, so its process page notes it.
	await editDefinition(
		db,
		{ id: alex.id },
		{
			definitionId: definitions.get('spouse-citizenship')!,
			baseRevision: 1,
			ops: [
				{
					op: 'set_content',
					id: 'step.submit-application',
					content: 'Book the appointment at the immigration office once every document is in.'
				}
			]
		}
	);

	// An agent acts for Alex, who granted it a delegation (ADR 0009).
	await grantDelegation(db, {
		delegatorId: alex.id,
		agentId: agent.id,
		namespaceId: sre,
		expiresAt: new Date(Date.now() + 365 * 86_400_000)
	});

	await seedCases(db, {
		files: options.files ?? memoryFileStore(),
		now: options.now ?? new Date(),
		definitions,
		people: { devon, wren, alex, sam, dana, agent },
		home,
		familyId: family.id
	});

	return { seeded: true, users: [olive, devon, wren, rae, alex, sam, dana, insurer] };
}

interface CaseSeed {
	files: FileStore;
	now: Date;
	definitions: Map<string, string>;
	people: Record<'devon' | 'wren' | 'alex' | 'sam' | 'dana' | 'agent', Principal>;
	home: string;
	familyId: string;
}

/** Lays out the demo cases' history through the runtime itself, backdated from `now`. */
async function seedCases(db: Db, seed: CaseSeed) {
	const { files, definitions } = seed;
	const { devon, wren, alex, sam, dana, agent } = seed.people;
	const ago = (days: number, hours = 0, minutes = 0) =>
		new Date(seed.now.getTime() - ((days * 24 + hours) * 60 + minutes) * 60_000);
	const as = (p: Principal): Actor => ({ id: p.id });
	const pdf = (slot: string, name: string, title: string): Upload => ({
		slot,
		name,
		contentType: 'application/pdf',
		bytes: demoPdf(title)
	});

	async function must<T>(result: Promise<T | RuntimeRefusal>): Promise<T> {
		const r = await result;
		if (typeof r === 'object' && r !== null && 'ok' in r && r.ok === false) {
			throw new Error(`demo seed: ${(r as RuntimeRefusal).reason}`);
		}
		return r as T;
	}
	const start = (by: Principal, at: Date, input: Parameters<typeof startCase>[2]) =>
		must(startCase(db, as(by), input, { now: at }));
	const complete = (
		by: Actor,
		at: Date,
		attachmentId: string,
		item: string,
		values: Record<string, string | string[]> = {},
		uploads: Upload[] = []
	) =>
		must(
			completeItem(
				db,
				by,
				{
					attachmentId,
					item,
					values: Object.fromEntries(
						Object.entries(values).map(([k, v]) => [k, Array.isArray(v) ? v : [v]])
					),
					files: uploads
				},
				{ files, now: at }
			)
		);

	// Mira: a newborn's birth registration, and the hospital's delivery bill.
	const mira = await start(alex, ago(40), {
		definitionId: definitions.get('birth-registration-abroad')!,
		title: 'Mira Example',
		subject: 'Newborn, born abroad on 12 Sept 2026',
		roles: { 'role.parent': [alex.id, sam.id] }
	});
	await complete(
		as(alex),
		ago(35),
		mira.attachmentId,
		'step.register-locally',
		{
			'fact.child-name': 'Mira Example',
			'fact.date-of-birth': '2026-09-12',
			'fact.country-of-birth': 'Portugal',
			'fact.local-birth-certificate': 'BC-2026-004417'
		},
		[
			pdf(
				'fact:fact.local-birth-certificate',
				'birth-certificate-scan.pdf',
				'Local birth certificate BC-2026-004417'
			),
			pdf('evidence:0', 'hospital-notification.pdf', 'Hospital birth notification')
		]
	);
	await complete(as(sam), ago(34), mira.attachmentId, 'decision.translation-required', {
		'fact.translation-required': 'no'
	});
	await must(
		startItem(
			db,
			as(sam),
			{ attachmentId: mira.attachmentId, item: 'step.complete-application' },
			{ now: ago(1, 3) }
		)
	);

	const delivery = await start(alex, ago(20), {
		definitionId: definitions.get('medical-bill-claim')!,
		caseId: mira.caseId,
		label: 'Delivery bill',
		roles: { 'role.claimant': [alex.id] }
	});
	// Dana is not a member of the family's casebook: binding her on the case makes her a guest.
	await bindRole(db, {
		principalId: dana.id,
		role: 'role.care-provider',
		accountId: seed.familyId,
		namespaceId: seed.home,
		caseId: mira.caseId
	});
	await complete(as(alex), ago(19), delivery.attachmentId, 'step.request-invoice', {
		'fact.patient-name': 'Mira Example',
		'fact.date-of-service': '2026-09-12',
		'fact.provider-name': 'Riverside Hospital',
		'fact.provider-contact': [dana.id]
	});

	// Sam: citizenship through marriage, paused on the apostille, and a physio claim at the insurer.
	const citizenship = await start(alex, ago(110), {
		definitionId: definitions.get('spouse-citizenship')!,
		title: 'Sam Example',
		subject: 'Citizenship through marriage, plus Sam’s health claims',
		roles: { 'role.sponsor': [alex.id], 'role.applicant': [sam.id] }
	});
	await complete(as(alex), ago(110), citizenship.attachmentId, 'step.record-marriage', {
		'fact.marriage-date': '2022-05-28',
		'fact.years-married': '4'
	});
	await complete(as(sam), ago(109), citizenship.attachmentId, 'decision.check-eligibility', {
		'fact.eligible': 'yes'
	});
	await complete(
		as(alex),
		ago(75),
		citizenship.attachmentId,
		'step.provide-citizenship-proof',
		{},
		[pdf('fact:fact.citizenship-proof', 'passport-alex.pdf', 'Passport photo page (Alex Example)')]
	);
	await must(
		holdItem(
			db,
			as(alex),
			{
				attachmentId: citizenship.attachmentId,
				item: 'step.provide-marriage-certificate',
				note: 'The apostille hasn’t come back from the registry in Lisbon yet. They said 2–3 weeks.'
			},
			{ now: ago(11) }
		)
	);
	await must(
		askQuestion(
			db,
			as(alex),
			{
				attachmentId: citizenship.attachmentId,
				item: 'step.provide-marriage-certificate',
				to: sam.id,
				text: 'Did the registry give you a reference number when you sent the certificate off? I can chase them with it.'
			},
			{ now: ago(10) }
		)
	);

	const physio = await start(alex, ago(53), {
		definitionId: definitions.get('medical-bill-claim')!,
		caseId: citizenship.caseId,
		label: 'Physio sessions',
		roles: { 'role.claimant': [alex.id, sam.id] }
	});
	await complete(as(sam), ago(53), physio.attachmentId, 'step.request-invoice', {
		'fact.patient-name': 'Sam Example',
		'fact.date-of-service': '2026-08-27',
		'fact.provider-name': 'Harbour Physio',
		'fact.provider-contact': [sam.id]
	});
	await complete(
		as(sam),
		ago(50),
		physio.attachmentId,
		'step.provide-invoice',
		{ 'fact.amount-billed': '360' },
		[
			pdf(
				'fact:fact.itemised-invoice',
				'harbour-physio-invoice.pdf',
				'Itemised invoice, Harbour Physio'
			)
		]
	);
	await complete(
		as(alex),
		ago(17),
		physio.attachmentId,
		'step.submit-claim',
		{ 'fact.claim-reference': 'CL-10422' },
		[pdf('fact:fact.payment-receipt', 'receipt-physio.pdf', 'Payment receipt, Harbour Physio')]
	);

	// Leo: started before a case had to name every role, so it waits on a Parent nobody holds
	// until an owner fixes who's who.
	await start(alex, ago(4), {
		definitionId: definitions.get('birth-registration-abroad')!,
		title: 'Leo Example',
		subject: 'Newborn, born abroad on 2 Oct 2026',
		roles: {}
	});

	// INC-2041: responding, with a status update due again.
	const latency = await start(devon, ago(0, 6), {
		definitionId: definitions.get('incident-management')!,
		title: 'INC-2041 Checkout latency',
		subject: 'Checkout p95 above 4s for EU customers'
	});
	await complete(as(devon), ago(0, 6), latency.attachmentId, 'step.report-incident', {
		'fact.incident-summary': 'Checkout p95 latency above 4s for EU customers since 05:30 UTC.',
		'fact.affected-services': ['checkout-api', 'payments-gateway']
	});
	await complete(as(wren), ago(0, 5, 50), latency.attachmentId, 'decision.classify-severity', {
		'fact.severity': 'SEV2'
	});
	await complete(as(wren), ago(0, 5, 40), latency.attachmentId, 'step.form-working-group', {
		'fact.working-group': [wren.id, alex.id, devon.id]
	});
	await complete(as(alex), ago(0, 0, 50), latency.attachmentId, 'step.post-status-update', {
		'fact.status-update':
			'Mitigation in progress: rolled back payments-gateway 3.14. Latency recovering.'
	});

	// INC-2043: just reported, waiting to be classified.
	const indexing = await start(devon, ago(0, 1), {
		definitionId: definitions.get('incident-management')!,
		title: 'INC-2043 Search indexing delay',
		subject: 'New products take 40 minutes to appear in search'
	});
	await complete(as(devon), ago(0, 1), indexing.attachmentId, 'step.report-incident', {
		'fact.incident-summary': 'New products take about 40 minutes to show in search results.',
		'fact.affected-services': ['search-indexer']
	});

	// INC-2038: resolved, its RCA waiting for the director's sign-off.
	const login = await start(devon, ago(6, 2), {
		definitionId: definitions.get('incident-management')!,
		title: 'INC-2038 Login errors',
		subject: 'Intermittent 502s on sign-in after a config push'
	});
	await complete(as(devon), ago(6, 2), login.attachmentId, 'step.report-incident', {
		'fact.incident-summary': 'Intermittent 502s on sign-in after an auth-proxy config push.',
		'fact.affected-services': ['auth-proxy']
	});
	await complete(as(wren), ago(6, 1, 50), login.attachmentId, 'decision.classify-severity', {
		'fact.severity': 'SEV3'
	});
	await complete(as(alex), ago(6, 1, 30), login.attachmentId, 'step.post-status-update', {
		'fact.status-update': 'Investigating 502s on sign-in; a config rollback is under way.'
	});
	await complete(as(wren), ago(6, 1), login.attachmentId, 'step.resolve-incident', {
		'fact.resolution-summary':
			'Reverted the auth-proxy config push; added a canary for config changes.',
		'fact.resolved-at': ago(6, 1, 5).toISOString()
	});
	await complete(
		{ id: agent.id, onBehalfOfId: alex.id },
		ago(6, 0, 40),
		login.attachmentId,
		'step.notify-downstream',
		{ 'fact.downstream-notified': 'yes' }
	);
	await complete(as(wren), ago(2), login.attachmentId, 'step.write-rca', {}, [
		pdf('fact:fact.rca-document', 'rca-inc-2038.pdf', 'Root cause analysis, INC-2038')
	]);
}

/** A one-page PDF saying it is a synthetic demo document (ADR 0014). */
export function demoPdf(title: string): Uint8Array {
	const text = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\x7e]/g, '-');
	const stream = [
		'BT /F1 18 Tf 72 720 Td',
		`(${text(title)}) Tj`,
		'0 -28 Td /F1 11 Tf',
		'(Synthetic demo document. Every name and number in casebook demo data is made up.) Tj',
		'ET'
	].join('\n');
	const objects = [
		'<< /Type /Catalog /Pages 2 0 R >>',
		'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
		'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
		`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
		'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
	];
	let body = '%PDF-1.4\n';
	const offsets: number[] = [];
	objects.forEach((o, i) => {
		offsets.push(body.length);
		body += `${i + 1} 0 obj\n${o}\nendobj\n`;
	});
	const xref = body.length;
	body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	body += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
	body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return new TextEncoder().encode(body);
}
