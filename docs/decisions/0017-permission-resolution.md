# 0017. Permission resolution

Status: Accepted. Builds on 0008, 0009, 0015 and 0016.

## Context
0015 defines account roles and namespace permissions, 0008 case bindings, and 0009 delegation, but none of them says how to answer "can principal X do Y on Z?". We need one answer that every write path and, later, the API and node operations share.

## Decision
One entry point, `can(db, actor, action, resource)` in `packages/store`, returns `{ allowed, reason }`. The reason says which binding allowed the action or which rule refused it.

It lives in the store rather than a new package for two reasons. It reads only store tables. And repository writes must run it inside their own transaction. A separate package would depend on the store, so the store could not call it without a cycle.

Actions are a fixed, extensible list. Each action names the resource types it applies to and the least permission it needs:

| Action | Resource | Needs |
|---|---|---|
| `account.manage_members` | account | account-owner or account-admin |
| `namespace.create` | account, or parent namespace | developer or above, or namespace-admin on the parent or an ancestor |
| `namespace.manage`, `namespace.manage_permissions` | namespace | namespace-admin |
| `definition.create` | namespace | write |
| `definition.read` | namespace or definition | read |
| `definition.edit`, `definition.publish` | definition | write |
| `definition.approve` | the publish being approved | write, plus the approval rules below |
| `definition.retire` | definition | namespace-admin |
| `case.bind_version` | case | write on the case's namespace |
| `case.act_in_role` | a process role on a case | that role on the case, or as a standing role |

Resolution:
- Account roles come first. Owners and admins are namespace-admin on every namespace in the account. Developers and read-only members can read every namespace in it. A developer is namespace-admin only of the namespaces they create, through the binding made when they create one.
- Then namespace permissions on the resource's namespace and its ancestors, nearest first. namespace-admin includes write, and write includes read.
- Then case bindings, for case resources. Process roles grant only `case.act_in_role`: definitions name them freely, so they carry no built-in permission. Resolution checks the case first, then standing roles along the namespace lineage (0008).
- Bindings held through groups count, including nested groups.
- Bindings never apply outside their account.

Delegation (0009):
- An agent must name the principal it acts for, and its own role bindings never count.
- To act for a user, the agent needs an active grant from that user: not revoked, and not expired at the time of the check. The grant's namespace, case and role limits must cover the resource. A role limit caps the agent at what that role alone would allow there. The agent may then do only what both the grant and the user allow.
- An unattended agent acting for its owning service gets that service's authority.
- An agent never acts for a group. Agents sign in as a user via OAuth through MCP and always act as that user, with authority resolved from that user's roles. Acting for a group is not a supported case.
- A service acts on its own bindings. When it acts for another principal, it also needs that principal's authority.
- A user acts only for themselves, and a group never acts.

Approvals are human-only. The approver is a user acting for themselves. They are neither the publisher nor the principal the publish is made on behalf of. The pure helper `approvalProblem` applies these rules, so node operations can use it without the store.

Repository writes that record who acted (create namespace, create definition, append draft revision, publish, retire, move case version) take an optional `Authorization`. With one, the write checks its actor with `can` inside its transaction, and refuses an actor other than the principal it records. Namespace creation always runs `can`, on the creator when no authorization is given. When an agent creates a namespace, the principal it acts for is bound as namespace-admin.

## Consequences
- Every refusal explains itself, which the API and UI can show as is.
- Adding an action is one entry in the rule table.
- Approval requirements on publish are still recorded only as a policy flag; enforcing them belongs to the approval flow.
- A move to OpenFGA or SpiceDB would replace `can`'s internals, not its callers.
