# 0023. Agents work cases over MCP, signed in as a user

Status: Accepted. Builds on 0009, 0017, 0020 and 0022.

## Context
Workstream 4 starts: agents work cases alongside people.
0009 and 0017 settle what an agent may do: it signs in as a user over OAuth through MCP, always acts for that user, and gets only what both its delegation and that user allow; approvals and steps marked `human` are for people.
The case runtime (0022) already takes an `Actor` on every read and write, records who acted and for whom, and scopes guests on the server.
There is no identity provider yet: the web app signs in with a dev-only choice of demo users (0020).

## Decision
- **A new package, `@casebook/mcp`, is an MCP server** built on the official TypeScript SDK (v2), served over Streamable HTTP as a separate dev process (`pnpm dev:mcp`, `http://localhost:5190/mcp`).
  Its tools mirror the runner: list my work (casebooks, a casebook's queues, guest requests), list and read processes (read-only), inspect a case, open a task, start a case, complete a task or record a decision with its values and files, start, pause, resume and skip a task, and read a case file.
  Each call goes through the store's runtime functions, so `can` decides it and the store's guest scoping applies.
- **There is no approval tool.** Completing an approval as an agent is refused as `human-only`, and so is deciding one through the store (0017).
- **The MCP endpoint is an OAuth 2.1 resource server** (MCP authorization, RFC 9728 protected resource metadata, RFC 8707 resource indicators).
  It checks bearer tokens through one small interface, `AgentSignIn`, which also names the authorization server clients are sent to.
- **For now the authorization server is a dev one** in the same process: dynamic client registration, the authorization code flow with PKCE (S256 only), refresh token rotation and revocation, and a sign-in page that picks one of the seeded users with no password, like the web app's.
  It refuses to start in production.
  Access tokens last 15 minutes, a sign-in 8 hours; tokens are random, held in memory only as hashes, and never logged, so restarting the server signs every agent out.
- **Each OAuth client is an agent principal**, made the first time a user signs it in, under the issuer `casebook-mcp-dev`.
  Signing in grants it a delegation from that user that expires with the sign-in; revoking the sign-in revokes the delegation.
  Every call acts as `{ agent, on behalf of the user }`, so events record the agent as actor and the user as `on_behalf_of`.

## Consequences
- An agent can do exactly what its user can, and nothing more: a user without the role is refused, guests see only their own forms, and approvals and human-only steps stay with people.
- An external OIDC issuer (0008) replaces the dev authorization server by implementing `AgentSignIn`: its metadata, no endpoints of its own here, and a token check that maps the token's subject to a user and its client to an agent principal.
- Delegations made at sign-in carry no namespace, case or role limit; narrower grants, and a screen for people to see and revoke their agents' sign-ins, are still to come.
- Registered clients live in memory, so clients register again after a restart.
