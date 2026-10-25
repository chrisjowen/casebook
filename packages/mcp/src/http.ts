// The MCP server over Streamable HTTP (ADR 0023), as one web-standard `fetch` handler: the OAuth
// discovery documents, the sign-in's own endpoints, and the MCP endpoint, which needs a bearer
// token and builds a server for the agent and user the token names. `nodeListener` serves it from
// `node:http`, as `cli/serve.ts` and the tests do.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { toNodeHandler } from '@modelcontextprotocol/node';
import {
	createMcpHandler,
	getOAuthProtectedResourceMetadataUrl,
	hostHeaderValidationResponse,
	localhostAllowedHostnames,
	oauthMetadataResponse,
	originValidationResponse,
	requireBearerAuth
} from '@modelcontextprotocol/server';
import type { Db, FileStore } from '@casebook/store';
import { actorOf, CASEBOOK_SCOPE, identityOf, type AgentSignIn } from './auth/sign-in.js';
import { casebookServer } from './tools.js';

/** The largest request the MCP endpoint reads: a 20 MB file as base64, with room to spare. */
export const MAX_REQUEST_BYTES = 30 * 1024 * 1024;

export interface CasebookMcpAppOptions {
	db: Db;
	files: FileStore;
	signIn: AgentSignIn;
	/** The MCP endpoint's public URL, such as `http://localhost:5190/mcp`. */
	resource: URL;
	/** Host names the server answers to, against DNS rebinding; localhost by default. */
	allowedHosts?: string[];
	/** Reports errors; never given tokens or request bodies. */
	onerror?: (error: Error) => void;
}

export interface CasebookMcpApp {
	fetch(request: Request): Promise<Response>;
	close(): Promise<void>;
}

export function casebookMcpApp(options: CasebookMcpAppOptions): CasebookMcpApp {
	const { db, files, signIn, resource } = options;
	const hosts = options.allowedHosts ?? localhostAllowedHostnames();
	const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(resource);
	const metadata = {
		oauthMetadata: signIn.metadata,
		resourceServerUrl: resource,
		scopesSupported: [CASEBOOK_SCOPE],
		resourceName: 'casebook',
		// Plain http is only for a dev issuer on this machine.
		dangerouslyAllowInsecureIssuerUrl: localhostAllowedHostnames().includes(
			new URL(signIn.metadata.issuer).hostname
		)
	};
	const gate = requireBearerAuth({
		verifier: signIn,
		requiredScopes: [CASEBOOK_SCOPE],
		resourceMetadataUrl,
		expectedResource: resource
	});
	const mcp = createMcpHandler(
		({ authInfo }) => casebookServer({ db, files, actor: actorOf(identityOf(authInfo)) }),
		{
			maxRequestBodySize: MAX_REQUEST_BYTES,
			...(options.onerror ? { onerror: options.onerror } : {})
		}
	);

	return {
		async fetch(request) {
			const rejected = hostHeaderValidationResponse(request, hosts);
			if (rejected) return rejected;
			const discovery = oauthMetadataResponse(request, metadata);
			if (discovery) return discovery;
			const signInResponse = await signIn.handle(request);
			if (signInResponse) return signInResponse;

			const { pathname } = new URL(request.url);
			if (pathname === resource.pathname) {
				const badOrigin = originValidationResponse(request, hosts);
				if (badOrigin) return badOrigin;
				const auth = await gate(request);
				if (auth instanceof Response) return auth;
				return mcp.fetch(request, { authInfo: auth });
			}
			if (pathname === '/' && request.method === 'GET') return home(resource);
			return new Response('Not found.', { status: 404 });
		},
		close: () => mcp.close()
	};
}

/** The app as a `node:http` request listener. */
export function nodeListener(app: CasebookMcpApp, onerror?: (error: Error) => void) {
	const handle = toNodeHandler(app, {
		maxRequestBodySize: MAX_REQUEST_BYTES,
		...(onerror ? { onerror } : {})
	});
	// The adapter's request type marks `method` as always set, which Node's does not promise.
	return (req: IncomingMessage, res: ServerResponse) =>
		void handle(req as Parameters<typeof handle>[0], res);
}

function home(resource: URL): Response {
	const text = `casebook MCP server

Connect an MCP client to ${resource.href} over Streamable HTTP.
It signs you in with OAuth: in development, you choose one of the demo users.
For Claude Code:

  claude mcp add --transport http casebook ${resource.href}
`;
	return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
