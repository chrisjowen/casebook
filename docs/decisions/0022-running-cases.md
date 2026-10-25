# 0022. Running cases

Status: Accepted. Amends 0016 and 0017.

## Context
Workstream 2 starts: people start cases from published definitions, see the work waiting on them, and record values, files and decisions.
A runner prototype was approved: an instance switcher, My work per instance, cases as workspaces with one stage strip per attached process, one focused form per task, a case record, and a Work | Processes switch.
Its open questions were settled by choosing the simplest experience: no claim button, facts shared case-wide, pausing notifies only whoever is waiting, a case is started by role holders and writers, the editor lives inside Processes, and guests see only their own form.

## Decision
- **Processes attach to a case.** A case is the subject (0001) and holds no version; each attached process is bound to a published version, pinned or following, under 0016's rules, which now apply per attachment. A case may run the same definition more than once, told apart by a label.
- **Runtime state is an event log.** Every change is a case event named with the reserved lifecycle events (0010), plus `step.held` and `step.resumed` for pausing, and records its actor and who they acted for (0009). Facts are rows that point at their `fact.recorded` event; the newest row is the value, and every process on the case shares it. Files live in a file store, local disk for now, behind a small interface; a file that is a fact's value is referred to as `casebook:file/<id>`.
- **Status is worked out when read.** `@casebook/model` folds the events into each work item's progress and evaluates the definition: done, skipped, ready, held, waiting (on whoever records a missing fact), blocked (nothing left records it) or upcoming; the current stage is the first with unsettled work. An approval sits in the stage of the step it reviews and opens when that step is done; a rejection sends the step back. A repeating step never holds its stage open and ends when its `until` condition holds.
- **Guards** (0004) are evaluated in a small, sandboxed expression language over facts, with three-valued logic: a guard that reads an unrecorded fact waits for it. A guard in prose only, or one that cannot be evaluated, is decided by the item's role, who either does the work or skips it with a reason.
- **Permissions** (0017) gain two actions: `case.start` on a definition, allowed by write on its namespace or by holding a role the definition declares, as a standing role or on a case it runs on; and `case.read` on a case, allowed by read on the case's namespace. Working on an item is `case.act_in_role` with the item's role. Steps marked `human` refuse agents. An approval comes from a user acting for themselves who neither did the reviewed step nor was it done for.
- **No claims.** Whoever finishes first completes an item; writes lock the case, so a second completion is refused and names who finished. Starting to fill a form in records `step.started`, which others see.
- **Scoping happens on the server.** An instance is an account the user holds an account role in. Members see the cases they can read; My work lists the items whose role they hold. A guest, who holds roles in an account but no account role, sees only the forms addressed to them, with only the values those forms use, one line of context and who asked.
- The definition editor moves inside Processes, at `/i/<instance>/processes/edit`.

## Consequences
- A process's progress always matches its events and current facts; there is no stored status to drift.
- Changing a fact one process recorded can move another process on the same case, since they share it.
- Notifications are only the in-app lists for now: a pause's note reaches whoever waits on that work through their My work.
- Role references in guard expressions are not evaluated yet; such guards are decided by the role like prose.
