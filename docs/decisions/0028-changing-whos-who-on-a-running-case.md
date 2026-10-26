# 0028. Changing who's who on a running case

Status: Accepted. Amends 0017 and 0022.

## Context
Who holds each case role is set when a process starts on a case, through the guided start's "Who's who" step (0026). New cases can no longer start with a role nobody holds, but older cases can sit waiting on "nobody yet", and holders change over a case's life: someone leaves, or the wrong person was named. Until now the only way out was to start the case again.

## Decision
- **Who's who is a panel on the case workspace.** It lists every role the case's processes declare, with the people named for it on the case and anyone holding it as a standing role on the case's namespace or an ancestor. A role nobody holds is highlighted with the ready and paused tasks waiting on it.
- **A new action, `case.manage_roles` on a case, needs namespace-admin** on the case's namespace or an ancestor, which account owners and admins hold everywhere (0015). Everyone else who can open the case sees the panel read-only; guests never open the case workspace, so never see it.
- **A change sets the role's holders on the case**: naming, replacing and removing are one write that binds and unbinds case-scoped role bindings. Standing bindings are never changed from a case. As at case start, the people named must already belong to the account or hold a role in it.
- **Every change is a `role.changed` case event**, with its actor and who they acted for (0009) and the role's case holders before and after. Saving the same holders records nothing. The case record lists who was named at start (`role.assigned`) and every change since.
- Status is still worked out when read (0022), so a task waiting on nobody waits on its new holders as soon as the change is saved, and shows on their My work.

## Consequences
- A stuck case recovers in place, keeping its history and facts.
- Removing everyone from a role puts its open work back to waiting on nobody; the panel shows that straight away.
- Write on a namespace is not enough to change who's who: naming people into roles stays with those who administer the namespace.
