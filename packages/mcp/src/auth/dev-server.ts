// The dev authorization server (ADR 0023): OAuth 2.1 sign-in for MCP clients, backed by the
// seeded demo users with no password, like the web app's dev sign-in (ADR 0020). It serves
// dynamic client registration (RFC 7591), the authorization code flow with PKCE (S256 only),
// refresh token rotation and revocation (RFC 7009), and issues tokens for one resource, the MCP
// endpoint (RFC 8707).
//
// Signing in makes the client an agent principal and grants it a delegation from the user for the
// length of the session (ADR 0009), so every call the agent makes acts for that user and can do
// only what they can. Clients, codes and tokens live in memory: restarting the server signs every
// agent out. Tokens are random, short-lived, stored only as hashes and never logged.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import {
	OAuthError,
	OAuthErrorCode,
	type AuthInfo,
	type OAuthMetadata
} from '@modelcontextprotocol/server';
import {
	createPrincipal,
	DEMO_ISSUER,
	findUser,
	grantDelegation,
	listUsers,
	revokeDelegation,
	schema,
	type Db,
	type UserSummary
} from '@casebook/store';
import { CASEBOOK_SCOPE, type AgentIdentity, type AgentSignIn } from './sign-in.js';

/** The issuer agent principals made by this server are recorded under. */
export const DEV_AGENT_ISSUER = 'casebook-mcp-dev';

export interface DevAuthorizationServerOptions {
	db: Db;
	/** The server's public origin, such as `http://localhost:5190`: the issuer of its tokens. */
	issuer: URL;
	/** The MCP endpoint, the one resource tokens are issued for. */
	resource: URL;
	/** How long an access token lasts, in seconds; 15 minutes by default. */
	accessTokenSeconds?: number;
	/**
	 * How long a sign-in lasts, refreshes included, in seconds; 8 hours by default. The agent's
	 * delegation grant expires with it.
	 */
	sessionSeconds?: number;
	/** The clock, for tests. */
	now?: () => Date;
}

interface Client {
	id: string;
	name: string;
	redirectUris: string[];
	issuedAt: number;
}

interface PendingAuthorization {
	clientId: string;
	redirectUri: string;
	state?: string;
	codeChallenge: string;
	resource: string;
	expiresAt: number;
}

interface Code {
	clientId: string;
	redirectUri: string;
	codeChallenge: string;
	resource: string;
	userId: string;
	expiresAt: number;
}

interface Session extends AgentIdentity {
	clientId: string;
	grantId: string;
	resource: string;
	endsAt: number;
}

interface IssuedToken {
	session: string;
	expiresAt: number;
}

const MAX_CLIENTS = 500;
const PENDING_SECONDS = 600;
const CODE_SECONDS = 120;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Starts the dev authorization server for the demo users. */
export function devAuthorizationServer(options: DevAuthorizationServerOptions): AgentSignIn {
	const { db } = options;
	const issuer = options.issuer.origin;
	const resource = normalizeResource(options.resource);
	const accessSeconds = options.accessTokenSeconds ?? 15 * 60;
	const sessionSeconds = options.sessionSeconds ?? 8 * 60 * 60;
	const now = () => (options.now ?? (() => new Date()))().getTime();

	const clients = new Map<string, Client>();
	const pending = new Map<string, PendingAuthorization>();
	const codes = new Map<string, Code>();
	const sessions = new Map<string, Session>();
	const accessTokens = new Map<string, IssuedToken>();
	const refreshTokens = new Map<string, IssuedToken>();

	const endpoint = (path: string) => `${issuer}${path}`;
	const metadata: OAuthMetadata = {
		issuer,
		authorization_endpoint: endpoint('/oauth/authorize'),
		token_endpoint: endpoint('/oauth/token'),
		registration_endpoint: endpoint('/oauth/register'),
		revocation_endpoint: endpoint('/oauth/revoke'),
		response_types_supported: ['code'],
		grant_types_supported: ['authorization_code', 'refresh_token'],
		code_challenge_methods_supported: ['S256'],
		token_endpoint_auth_methods_supported: ['none'],
		revocation_endpoint_auth_methods_supported: ['none'],
		scopes_supported: [CASEBOOK_SCOPE],
		authorization_response_iss_parameter_supported: true
	};

	/** Drops whatever has expired, so the maps stay small. */
	function sweep() {
		const t = now();
		for (const map of [pending, codes, accessTokens] as Map<string, { expiresAt: number }>[]) {
			for (const [key, value] of map) if (value.expiresAt <= t) map.delete(key);
		}
		for (const [id, session] of sessions) if (session.endsAt <= t) endSession(id);
	}

	function endSession(id: string) {
		sessions.delete(id);
		for (const map of [accessTokens, refreshTokens]) {
			for (const [key, value] of map) if (value.session === id) map.delete(key);
		}
	}

	// Registration (RFC 7591)

	async function register(request: Request): Promise<Response> {
		if (request.method !== 'POST') return methodNotAllowed('POST');
		let body: Record<string, unknown>;
		try {
			body = (await request.json()) as Record<string, unknown>;
		} catch {
			return registrationError('The registration request must be JSON.');
		}
		const uris = body.redirect_uris;
		if (!Array.isArray(uris) || uris.length === 0 || !uris.every((u) => typeof u === 'string')) {
			return registrationError('Give at least one redirect URI.', 'invalid_redirect_uri');
		}
		const bad = (uris as string[]).find((u) => redirectUriProblem(u) !== undefined);
		if (bad !== undefined) {
			return registrationError(redirectUriProblem(bad)!, 'invalid_redirect_uri');
		}
		const method = body.token_endpoint_auth_method;
		if (method !== undefined && method !== 'none') {
			return registrationError(
				'Only public clients are supported: use token_endpoint_auth_method "none" with PKCE.'
			);
		}
		const name =
			typeof body.client_name === 'string' && body.client_name.trim()
				? body.client_name.trim().slice(0, 80)
				: 'MCP client';
		const client: Client = {
			id: randomUUID(),
			name,
			redirectUris: uris as string[],
			issuedAt: Math.floor(now() / 1000)
		};
		if (clients.size >= MAX_CLIENTS) clients.delete(clients.keys().next().value!);
		clients.set(client.id, client);
		return json(
			{
				client_id: client.id,
				client_id_issued_at: client.issuedAt,
				client_name: client.name,
				redirect_uris: client.redirectUris,
				grant_types: ['authorization_code', 'refresh_token'],
				response_types: ['code'],
				token_endpoint_auth_method: 'none',
				scope: CASEBOOK_SCOPE
			},
			201
		);
	}

	// Authorization

	async function authorize(request: Request): Promise<Response> {
		sweep();
		if (request.method === 'GET') return authorizePage(new URL(request.url).searchParams);
		if (request.method === 'POST') return authorizeDecision(request);
		return methodNotAllowed('GET, POST');
	}

	async function authorizePage(params: URLSearchParams): Promise<Response> {
		const client = clients.get(params.get('client_id') ?? '');
		if (!client) {
			return page(
				'Unknown client',
				'<p>This client is not registered here. Ask it to connect again; restarting the casebook MCP server signs every agent out.</p>',
				400
			);
		}
		const redirectUri = params.get('redirect_uri') ?? '';
		if (!client.redirectUris.some((u) => sameRedirect(u, redirectUri))) {
			return page(
				'Wrong redirect',
				'<p>The redirect URI is not one the client registered.</p>',
				400
			);
		}
		const state = params.get('state') ?? undefined;
		const back = (error: string, description: string) =>
			redirect(redirectUri, { error, error_description: description, state, iss: issuer });
		if (params.get('response_type') !== 'code') {
			return back('unsupported_response_type', 'Only the authorization code flow is supported.');
		}
		const challenge = params.get('code_challenge');
		if (!challenge || params.get('code_challenge_method') !== 'S256') {
			return back('invalid_request', 'PKCE with code_challenge_method S256 is required.');
		}
		const asked = params.get('resource');
		if (asked !== null && normalizeResource(asked) !== resource) {
			return back('invalid_target', `Tokens here are only for ${resource}.`);
		}
		const id = randomToken();
		pending.set(hash(id), {
			clientId: client.id,
			redirectUri,
			codeChallenge: challenge,
			resource,
			expiresAt: now() + PENDING_SECONDS * 1000,
			...(state !== undefined ? { state } : {})
		});
		const users = await listUsers(db, DEMO_ISSUER);
		return page('Connect an agent', consentForm(client, redirectUri, id, users));
	}

	async function authorizeDecision(request: Request): Promise<Response> {
		const origin = request.headers.get('origin');
		if (origin !== null && origin !== issuer) {
			return page('Not allowed', '<p>That sign-in came from another site.</p>', 403);
		}
		const form = await request.formData();
		const key = hash(String(form.get('request') ?? ''));
		const asked = pending.get(key);
		pending.delete(key);
		if (!asked || asked.expiresAt <= now()) {
			return page(
				'Sign-in expired',
				'<p>That sign-in has expired or was already used. Connect the agent again.</p>',
				400
			);
		}
		const back = (params: Record<string, string | undefined>) =>
			redirect(asked.redirectUri, { ...params, state: asked.state, iss: issuer });
		if (form.get('decision') !== 'allow') {
			return back({ error: 'access_denied', error_description: 'The user did not allow it.' });
		}
		const user = await findUser(db, DEMO_ISSUER, String(form.get('user') ?? ''));
		if (!user) {
			return back({ error: 'access_denied', error_description: 'Choose who to sign in as.' });
		}
		const code = randomToken();
		codes.set(hash(code), {
			clientId: asked.clientId,
			redirectUri: asked.redirectUri,
			codeChallenge: asked.codeChallenge,
			resource: asked.resource,
			userId: user.id,
			expiresAt: now() + CODE_SECONDS * 1000
		});
		return back({ code });
	}

	// Tokens

	async function token(request: Request): Promise<Response> {
		if (request.method !== 'POST') return methodNotAllowed('POST');
		sweep();
		let form: URLSearchParams;
		try {
			form = new URLSearchParams(await request.text());
		} catch {
			return tokenError(OAuthErrorCode.InvalidRequest, 'Send the token request as a form.');
		}
		const clientId = form.get('client_id') ?? '';
		const client = clients.get(clientId);
		if (!client) return tokenError(OAuthErrorCode.InvalidClient, 'Unknown client.', 401);
		const asked = form.get('resource');
		if (asked !== null && normalizeResource(asked) !== resource) {
			return tokenError('invalid_target', `Tokens here are only for ${resource}.`);
		}
		switch (form.get('grant_type')) {
			case 'authorization_code':
				return exchangeCode(client, form);
			case 'refresh_token':
				return refresh(client, form);
			default:
				return tokenError(
					OAuthErrorCode.UnsupportedGrantType,
					'Use authorization_code or refresh_token.'
				);
		}
	}

	async function exchangeCode(client: Client, form: URLSearchParams): Promise<Response> {
		const key = hash(form.get('code') ?? '');
		const code = codes.get(key);
		codes.delete(key);
		const invalid = () =>
			tokenError(OAuthErrorCode.InvalidGrant, 'The code is not valid; sign in again.');
		if (!code || code.expiresAt <= now() || code.clientId !== client.id) return invalid();
		if (form.get('redirect_uri') !== code.redirectUri) return invalid();
		const verifier = form.get('code_verifier') ?? '';
		if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || s256(verifier) !== code.codeChallenge) {
			return invalid();
		}
		const user = await findUser(db, DEMO_ISSUER, code.userId);
		if (!user) return invalid();
		const agentId = await agentFor(client);
		const endsAt = now() + sessionSeconds * 1000;
		const grant = await grantDelegation(
			db,
			{ delegatorId: user.id, agentId, expiresAt: new Date(endsAt) },
			new Date(now())
		);
		const id = randomUUID();
		sessions.set(id, {
			agentId,
			userId: user.id,
			clientId: client.id,
			grantId: grant.id,
			resource: code.resource,
			endsAt
		});
		return issue(id);
	}

	async function refresh(client: Client, form: URLSearchParams): Promise<Response> {
		const key = hash(form.get('refresh_token') ?? '');
		const issued = refreshTokens.get(key);
		const session = issued && sessions.get(issued.session);
		const invalid = () =>
			tokenError(OAuthErrorCode.InvalidGrant, 'The sign-in has ended; sign in again.');
		if (!issued || !session || session.clientId !== client.id) return invalid();
		refreshTokens.delete(key);
		if (session.endsAt <= now() || !(await grantActive(session.grantId))) {
			endSession(issued.session);
			return invalid();
		}
		return issue(issued.session);
	}

	function issue(sessionId: string): Response {
		const session = sessions.get(sessionId)!;
		const access = randomToken();
		const refreshToken = randomToken();
		const expiresAt = Math.min(now() + accessSeconds * 1000, session.endsAt);
		accessTokens.set(hash(access), { session: sessionId, expiresAt });
		refreshTokens.set(hash(refreshToken), { session: sessionId, expiresAt: session.endsAt });
		return json({
			access_token: access,
			token_type: 'Bearer',
			expires_in: Math.max(1, Math.floor((expiresAt - now()) / 1000)),
			refresh_token: refreshToken,
			scope: CASEBOOK_SCOPE
		});
	}

	async function grantActive(grantId: string): Promise<boolean> {
		const [row] = await db
			.select({ id: schema.delegationGrants.id })
			.from(schema.delegationGrants)
			.where(
				and(
					eq(schema.delegationGrants.id, grantId),
					isNull(schema.delegationGrants.revokedAt),
					gt(schema.delegationGrants.expiresAt, new Date(now()))
				)
			);
		return row !== undefined;
	}

	/** The agent principal that stands for a client, made the first time someone signs it in. */
	async function agentFor(client: Client): Promise<string> {
		const subject = `client:${client.id}`;
		const find = async () => {
			const [row] = await db
				.select({ id: schema.principals.id })
				.from(schema.principals)
				.where(
					and(
						eq(schema.principals.issuer, DEV_AGENT_ISSUER),
						eq(schema.principals.subject, subject)
					)
				);
			return row?.id;
		};
		const found = await find();
		if (found) return found;
		try {
			const agent = await createPrincipal(db, {
				kind: 'agent',
				displayName: client.name,
				issuer: DEV_AGENT_ISSUER,
				subject
			});
			return agent.id;
		} catch (error) {
			// Two sign-ins of one client at once: the other made it.
			const raced = await find();
			if (raced) return raced;
			throw error;
		}
	}

	// Revocation (RFC 7009)

	async function revoke(request: Request): Promise<Response> {
		if (request.method !== 'POST') return methodNotAllowed('POST');
		const form = new URLSearchParams(await request.text());
		const key = hash(form.get('token') ?? '');
		const issued = refreshTokens.get(key) ?? accessTokens.get(key);
		const session = issued && sessions.get(issued.session);
		// Revoking either token ends the sign-in and the agent's delegation with it.
		if (issued && session && session.clientId === form.get('client_id')) {
			endSession(issued.session);
			try {
				await revokeDelegation(db, session.grantId, new Date(now()));
			} catch {
				// Already revoked.
			}
		}
		return new Response(null, { status: 200, headers: CORS });
	}

	return {
		metadata,
		async handle(request) {
			const { pathname } = new URL(request.url);
			const route = ROUTES[pathname];
			if (!route) return undefined;
			if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
			return { register, authorize, token, revoke }[route](request);
		},
		async verifyAccessToken(accessToken) {
			const issued = accessTokens.get(hash(accessToken));
			const session = issued && sessions.get(issued.session);
			if (!issued || !session || issued.expiresAt <= now()) {
				throw new OAuthError(OAuthErrorCode.InvalidToken, 'The access token is not valid.');
			}
			return {
				token: accessToken,
				clientId: session.clientId,
				scopes: [CASEBOOK_SCOPE],
				expiresAt: Math.floor(issued.expiresAt / 1000),
				resource: new URL(session.resource),
				extra: { agentId: session.agentId, userId: session.userId }
			} satisfies AuthInfo;
		}
	};
}

const ROUTES: Record<string, 'register' | 'authorize' | 'token' | 'revoke'> = {
	'/oauth/register': 'register',
	'/oauth/authorize': 'authorize',
	'/oauth/token': 'token',
	'/oauth/revoke': 'revoke'
};

const CORS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, Authorization, MCP-Protocol-Version'
};

const randomToken = () => randomBytes(32).toString('base64url');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const s256 = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');

/** A resource URL compared without a fragment or a trailing slash, as MCP clients send it. */
function normalizeResource(url: string | URL): string {
	try {
		const parsed = new URL(url);
		parsed.hash = '';
		return parsed.href.replace(/\/$/, '');
	} catch {
		return '';
	}
}

/** Why a client may not register this redirect URI, if it may not. */
function redirectUriProblem(uri: string): string | undefined {
	let url: URL;
	try {
		url = new URL(uri);
	} catch {
		return `"${uri}" is not an absolute URL.`;
	}
	if (url.hash) return 'A redirect URI cannot have a fragment.';
	if (['javascript:', 'data:', 'file:', 'vbscript:', 'blob:'].includes(url.protocol)) {
		return `${url.protocol} redirect URIs are not allowed.`;
	}
	if (url.protocol === 'http:' && !LOOPBACK.has(url.hostname)) {
		return 'Plain http redirect URIs must be on localhost.';
	}
	return undefined;
}

/**
 * True when a requested redirect URI matches a registered one: exactly, or on a loopback host
 * with any port, since native apps pick a free port each time (RFC 8252).
 */
function sameRedirect(registered: string, requested: string): boolean {
	if (registered === requested) return true;
	try {
		const a = new URL(registered);
		const b = new URL(requested);
		return (
			a.protocol === 'http:' &&
			LOOPBACK.has(a.hostname) &&
			a.hostname === b.hostname &&
			a.protocol === b.protocol &&
			a.pathname === b.pathname &&
			a.search === b.search
		);
	} catch {
		return false;
	}
}

function redirect(to: string, params: Record<string, string | undefined>): Response {
	const url = new URL(to);
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined) url.searchParams.set(key, value);
	}
	return new Response(null, {
		status: 302,
		headers: { Location: url.toString(), 'Cache-Control': 'no-store' }
	});
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			...CORS,
			'Content-Type': 'application/json',
			'Cache-Control': 'no-store',
			Pragma: 'no-cache'
		}
	});
}

const tokenError = (error: string, description: string, status = 400) =>
	json({ error, error_description: description }, status);

const registrationError = (description: string, error = 'invalid_client_metadata') =>
	json({ error, error_description: description }, 400);

const methodNotAllowed = (allow: string) =>
	new Response('Method not allowed.', { status: 405, headers: { ...CORS, Allow: allow } });

const escape = (text: string) =>
	text.replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
	);

function consentForm(
	client: Client,
	redirectUri: string,
	requestId: string,
	users: UserSummary[]
): string {
	const name = escape(client.name);
	const people = users
		.map(
			(u, i) => `
			<label class="user">
				<input type="radio" name="user" value="${escape(u.id)}"${i === 0 ? ' checked' : ''}>
				<span><strong>${escape(u.displayName)}</strong><small>${escape(u.roles.join(' · ') || 'no roles')}</small></span>
			</label>`
		)
		.join('');
	return `
		<p><strong>${name}</strong> wants to work in casebook as you.</p>
		<p>It acts as you: it sees and does only what you can, and everything it changes is recorded as done by ${name} on your behalf. It cannot approve anything; approvals stay with people. The sign-in lasts a working day, or until the agent signs out.</p>
		<form method="post">
			<input type="hidden" name="request" value="${escape(requestId)}">
			<fieldset>
				<legend>Development sign-in: choose a demo user</legend>
				${people}
			</fieldset>
			<div class="actions">
				<button type="submit" name="decision" value="allow">Allow</button>
				<button type="submit" name="decision" value="deny" class="quiet">Deny</button>
			</div>
		</form>
		<p class="note">This page has no password and exists only in development. Afterwards you return to ${escape(new URL(redirectUri).host || redirectUri)}.</p>`;
}

function page(title: string, body: string, status = 200): Response {
	const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} · casebook</title>
<style>
	:root { color-scheme: light dark; --bg: #fafaf9; --fg: #1c1917; --muted: #78716c; --line: #e7e5e4; --accent: #1d4ed8; }
	@media (prefers-color-scheme: dark) { :root { --bg: #1c1917; --fg: #fafaf9; --muted: #a8a29e; --line: #44403c; --accent: #93c5fd; } }
	body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, sans-serif; }
	main { max-width: 34rem; margin: 3rem auto; padding: 0 1rem; }
	h1 { font-size: 1.25rem; margin: 0 0 1rem; }
	fieldset { border: 1px solid var(--line); border-radius: 8px; padding: .5rem .75rem; margin: 1rem 0; }
	legend { color: var(--muted); font-size: .85rem; padding: 0 .25rem; }
	.user { display: flex; gap: .6rem; align-items: flex-start; padding: .4rem 0; cursor: pointer; }
	.user span { display: flex; flex-direction: column; }
	.user small { color: var(--muted); }
	.actions { display: flex; gap: .5rem; }
	button { font: inherit; padding: .45rem 1rem; border-radius: 6px; border: 1px solid var(--accent); background: var(--accent); color: var(--bg); cursor: pointer; }
	button.quiet { background: transparent; color: var(--fg); border-color: var(--line); }
	.note { color: var(--muted); font-size: .85rem; }
</style>
</head>
<body><main><h1>${escape(title)}</h1>${body}</main></body>
</html>`;
	return new Response(html, {
		status,
		headers: {
			'Content-Type': 'text/html; charset=utf-8',
			'Cache-Control': 'no-store',
			'X-Frame-Options': 'DENY',
			'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'"
		}
	});
}
