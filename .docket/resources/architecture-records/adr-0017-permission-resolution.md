---
id: architecture_record.adr-0017
type: architecture_record
title: "ADR 0017: Permission resolution"

tags:
  - adr

attributes:
  number: 17
  path: docs/decisions/0017-permission-resolution.md
  status: accepted

links:
  - rel: stored_in
    target: repository.casebook
    evidence:
      - source: docs
        path: docs/decisions/README.md
        observedAt: 2026-10-31
        observedBy: claude
        note: Listed in casebook's decision log as Accepted.

evidence:
  - source: docs
    path: docs/decisions/0017-permission-resolution.md
    lines: 1-52
    symbol: "0017. Permission resolution"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/docs/decisions/0017-permission-resolution.md
    observedAt: 2026-10-31
    observedBy: claude
    note: "ADR file with status line 'Accepted. Builds on 0008, 0009, 0015 and 0016.'."

provenance:
  capturedBy: claude
---

# ADR 0017: Permission resolution

Casebook's architecture decision record 0017, "Permission resolution", kept in
`docs/decisions/0017-permission-resolution.md` and listed in the decision log `docs/decisions/README.md`.
Status: Accepted. Builds on 0008, 0009, 0015 and 0016.

What it decides, condensed from its Decision section: One entry point, `can(db, actor, action, resource)` in `packages/store`, returns `{ allowed, reason }`. The reason says which binding allowed the action or which rule refused it. It lives in the store rather than a new package for two reasons. It reads only store tables. And repository writes must run it inside their own transaction. A separate package would depend on the store, so the store could not call it without a cycle. Actions are a fixed, extensible list. Each action names the resource types it applies to and the least permission it needs: | Action | Resource | Needs | |---|---|---| | `account.manage_members` | account | account-owner or account-admin | | `namespace.create` | …

Its status line relates it to earlier records: [[architecture_record.adr-0008]], [[architecture_record.adr-0009]], [[architecture_record.adr-0015]], [[architecture_record.adr-0016]] ("Accepted. Builds on 0008, 0009, 0015 and 0016.").

Captured from the ADR file during docket's initial scan; the ADR itself is
the authority for context and consequences.
