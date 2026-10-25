# 0008. Principals, roles and role bindings

Status: Accepted

## Context
We need roles and users now, with external IdP integration and a dedicated authorization service possible later.

## Decision
Principals are users, groups and agents, keyed by OIDC-shaped `(issuer, subject)`, with one built-in issuer to start.
Process roles are abstract slots in definitions.
Role bindings exist at namespace level (standing) and case level (assigned at runtime, for example a working group produced by a step).
Resolution order is case, then namespace, then parent namespace.
Bindings are stored as Zanzibar-style `(principal, role, scope)` tuples.

## Consequences
- An external IdP plugs in as another issuer.
- The tuple shape allows a later move to OpenFGA or SpiceDB.
- Definitions stay portable because they never name real people.
