// How an agent signs in to casebook as a user (ADR 0023). The MCP endpoint is an OAuth 2.1
// resource server: it only checks access tokens, and points clients at whichever authorization
// server an `AgentSignIn` names. The dev authorization server is one; an external OIDC issuer
// (ADR 0008) can replace it behind the same interface.
import {
	OAuthError,
	OAuthErrorCode,
	type AuthInfo,
	type OAuthMetadata
} from '@modelcontextprotocol/server';
import type { Actor } from '@casebook/store';

/** The scope an agent asks for to act as its user. */
export const CASEBOOK_SCOPE = 'casebook';

/**
 * Who a verified access token lets act: an agent principal, on behalf of the one user who
 * signed in (ADR 0009). The agent holds a delegation grant from that user for the session.
 */
export interface AgentIdentity {
	agentId: string;
	userId: string;
}

export interface AgentSignIn {
	/** Authorization server metadata (RFC 8414), which the MCP endpoint advertises to clients. */
	readonly metadata: OAuthMetadata;
	/**
	 * Answers a request for one of the sign-in's own endpoints, or returns undefined for any other
	 * path. An external issuer serves its own endpoints, so it answers nothing here.
	 */
	handle(request: Request): Promise<Response | undefined>;
	/**
	 * Checks an access token. Resolves with its `AuthInfo`, whose `extra` is an `AgentIdentity`;
	 * throws an `OAuthError` with `invalid_token` for a token that is unknown, expired or revoked.
	 */
	verifyAccessToken(token: string): Promise<AuthInfo>;
}

/** The agent and user a verified token names. */
export function identityOf(auth: AuthInfo | undefined): AgentIdentity {
	const extra = auth?.extra as Partial<AgentIdentity> | undefined;
	if (typeof extra?.agentId !== 'string' || typeof extra.userId !== 'string') {
		throw new OAuthError(OAuthErrorCode.InvalidToken, 'The token does not name a user.');
	}
	return { agentId: extra.agentId, userId: extra.userId };
}

/** The store actor for a signed-in agent: the agent, acting on behalf of its user. */
export function actorOf(identity: AgentIdentity): Actor {
	return { id: identity.agentId, onBehalfOfId: identity.userId };
}
