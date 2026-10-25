import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
	Client,
	StreamableHTTPClientTransport,
	type OAuthClientMetadata,
	type OAuthClientProvider,
	type OAuthDiscoveryState,
	type StoredOAuthClientInformation,
	type StoredOAuthTokens
} from '@modelcontextprotocol/client';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { schema } from '@casebook/store';
import { DEV_AGENT_ISSUER, devAuthorizationServer } from '../src/auth/dev-server.js';
import { casebookMcpApp, nodeListener, type CasebookMcpApp } from '../src/http.js';
import { demoWorld, type World } from './world.js';

const url = inject('databaseUrl');

/** An MCP client's OAuth state, kept in memory, as Claude Code or Claude Desktop would keep it. */
class MemoryProvider implements OAuthClientProvider {
	client?: StoredOAuthClientInformation;
	saved?: StoredOAuthTokens;
	verifier = '';
	discovery?: OAuthDiscoveryState;
	authorizationUrl?: URL;

	get redirectUrl() {
		return 'http://127.0.0.1:33418/callback';
	}
	get clientMetadata(): OAuthClientMetadata {
		return {
			client_name: 'Test client',
			redirect_uris: [this.redirectUrl],
			grant_types: ['authorization_code', 'refresh_token'],
			response_types: ['code'],
			token_endpoint_auth_method: 'none'
		};
	}
	clientInformation() {
		return this.client;
	}
	saveClientInformation(info: StoredOAuthClientInformation) {
		this.client = info;
	}
	tokens() {
		return this.saved;
	}
	saveTokens(tokens: StoredOAuthTokens) {
		this.saved = tokens;
	}
	redirectToAuthorization(authorizationUrl: URL) {
		this.authorizationUrl = authorizationUrl;
	}
	saveCodeVerifier(verifier: string) {
		this.verifier = verifier;
	}
	codeVerifier() {
		return this.verifier;
	}
	saveDiscoveryState(state: OAuthDiscoveryState) {
		this.discovery = state;
	}
	discoveryState() {
		return this.discovery;
	}
}

describe.skipIf(!url)('signing an agent in over OAuth (Postgres)', () => {
	let world: World;
	let server: Server;
	let app: CasebookMcpApp;
	let base: URL;
	let resource: URL;

	beforeAll(async () => {
		world = await demoWorld(url!, 'oauth');
		server = createServer();
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		base = new URL(`http://localhost:${(server.address() as AddressInfo).port}`);
		resource = new URL('/mcp', base);
		app = casebookMcpApp({
			db: world.db,
			files: world.files,
			signIn: devAuthorizationServer({ db: world.db, issuer: base, resource }),
			resource
		});
		server.on('request', nodeListener(app));
	});
	afterAll(async () => {
		await new Promise((resolve) => server?.close(resolve));
		await app?.close();
		await world?.close();
	});

	/** The person at the browser: opens the sign-in page, picks a user and answers. */
	async function signIn(authorizationUrl: URL, userId: string, decision = 'allow') {
		const page = await fetch(authorizationUrl);
		expect(page.status).toBe(200);
		const html = await page.text();
		const request = /name="request" value="([^"]+)"/.exec(html)![1]!;
		const answer = await fetch(authorizationUrl, {
			method: 'POST',
			headers: { origin: base.origin },
			body: new URLSearchParams({ request, user: userId, decision }),
			redirect: 'manual'
		});
		expect(answer.status).toBe(302);
		return { html, callback: new URL(answer.headers.get('location')!) };
	}

	it('signs an agent in as a user, then acts as them until signed out', async () => {
		const provider = new MemoryProvider();
		const first = new Client({ name: 'test', version: '0.0.0' });
		await expect(
			first.connect(new StreamableHTTPClientTransport(resource, { authProvider: provider }))
		).rejects.toThrow();
		// The client discovered the sign-in, registered itself and sent the user to authorize.
		expect(provider.client?.client_id).toBeTruthy();
		expect(provider.authorizationUrl?.pathname).toBe('/oauth/authorize');
		expect(provider.authorizationUrl?.searchParams.get('code_challenge_method')).toBe('S256');

		const { html, callback } = await signIn(provider.authorizationUrl!, world.users.alex.id);
		expect(html).toContain('Test client');
		expect(html).toContain('Alex Example');
		expect(callback.searchParams.get('iss')).toBe(base.origin);
		const transport = new StreamableHTTPClientTransport(resource, { authProvider: provider });
		await transport.finishAuth(callback.searchParams);
		expect(provider.saved?.access_token).toBeTruthy();
		expect(provider.saved?.expires_in).toBeLessThanOrEqual(15 * 60);

		const client = new Client({ name: 'test', version: '0.0.0' });
		await client.connect(transport);
		const { tools } = await client.listTools();
		expect(tools.map((t) => t.name)).toEqual(
			expect.arrayContaining(['list_my_work', 'read_process', 'inspect_case', 'complete_task'])
		);
		expect(tools.map((t) => t.name)).not.toContain('decide_approval');
		const result = await client.callTool({ name: 'list_my_work', arguments: {} });
		const body = JSON.parse((result.content as { text: string }[])[0]!.text);
		expect(body.signedIn).toMatchObject({ as: 'Alex Example', agent: 'Test client' });

		// The client is an agent principal holding an expiring delegation from Alex.
		const [agent] = await world.db
			.select()
			.from(schema.principals)
			.where(
				and(
					eq(schema.principals.issuer, DEV_AGENT_ISSUER),
					eq(schema.principals.subject, `client:${provider.client!.client_id}`)
				)
			);
		expect(agent).toMatchObject({ kind: 'agent', displayName: 'Test client' });
		const [grant] = await world.db
			.select()
			.from(schema.delegationGrants)
			.where(eq(schema.delegationGrants.agentId, agent!.id));
		expect(grant).toMatchObject({ delegatorId: world.users.alex.id, revokedAt: null });
		expect(grant!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 7 * 3_600_000);

		// Revoking the refresh token signs the agent out and ends its delegation.
		const revoked = await fetch(new URL('/oauth/revoke', base), {
			method: 'POST',
			body: new URLSearchParams({
				token: provider.saved!.refresh_token!,
				client_id: provider.client!.client_id
			})
		});
		expect(revoked.status).toBe(200);
		const [after] = await world.db
			.select()
			.from(schema.delegationGrants)
			.where(eq(schema.delegationGrants.id, grant!.id));
		expect(after!.revokedAt).not.toBeNull();
		const denied = await fetch(resource, {
			method: 'POST',
			headers: {
				authorization: `Bearer ${provider.saved!.access_token}`,
				'content-type': 'application/json',
				accept: 'application/json, text/event-stream'
			},
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
		});
		expect(denied.status).toBe(401);
		expect(denied.headers.get('www-authenticate')).toContain('resource_metadata=');
	});

	it('refuses a code without the right PKCE verifier, and a denied sign-in', async () => {
		const register = await fetch(new URL('/oauth/register', base), {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ client_name: 'Direct', redirect_uris: ['http://localhost:4000/cb'] })
		});
		expect(register.status).toBe(201);
		const { client_id } = (await register.json()) as { client_id: string };
		const authorize = new URL('/oauth/authorize', base);
		authorize.search = new URLSearchParams({
			response_type: 'code',
			client_id,
			redirect_uri: 'http://localhost:4000/cb',
			code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
			code_challenge_method: 'S256',
			state: 'xyz',
			resource: resource.href
		}).toString();

		const { callback } = await signIn(authorize, world.users.rae.id);
		expect(callback.searchParams.get('state')).toBe('xyz');
		const exchange = (verifier: string) =>
			fetch(new URL('/oauth/token', base), {
				method: 'POST',
				body: new URLSearchParams({
					grant_type: 'authorization_code',
					code: callback.searchParams.get('code')!,
					redirect_uri: 'http://localhost:4000/cb',
					client_id,
					code_verifier: verifier
				})
			});
		const wrong = await exchange('a'.repeat(43));
		expect(wrong.status).toBe(400);
		expect(await wrong.json()).toMatchObject({ error: 'invalid_grant' });
		// A code is single-use, so even the right verifier fails after a wrong one.
		const right = await exchange('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');
		expect(right.status).toBe(400);

		const { callback: deniedCallback } = await signIn(authorize, world.users.rae.id, 'deny');
		expect(deniedCallback.searchParams.get('error')).toBe('access_denied');
		expect(deniedCallback.searchParams.get('code')).toBeNull();
	});
});
