# 0009. Agents are first-class principals with delegation

Status: Accepted

## Context
Agents will act in processes, but must be accountable and must know which user they act for.

## Decision
Agents are first-class principals.
Users grant delegations to agents, scoped by namespace, case, role and expiry.
An agent's effective authority is the intersection of its grants and the delegating user's bindings.
Every event records `actor` and `on_behalf_of`; each action is on behalf of exactly one user or one group.
Unattended agents act for an owning service principal.
Steps marked `actor: human` cannot be completed by agents.

## Consequences
- Agents never exceed the authority of the user they serve.
- The audit trail separates who acted from who was represented.
- Delegation management needs UI and expiry handling.
