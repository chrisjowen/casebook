---
id: architecture_record.adr-0009
type: architecture_record
title: "ADR 0009: Agents are first-class principals with delegation"

tags:
  - adr

attributes:
  number: 9
  path: docs/decisions/0009-agents-as-principals.md
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
    path: docs/decisions/0009-agents-as-principals.md
    lines: 1-20
    symbol: "0009. Agents are first-class principals with delegation"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/docs/decisions/0009-agents-as-principals.md
    observedAt: 2026-10-31
    observedBy: claude
    note: "ADR file with status line 'Accepted'."

provenance:
  capturedBy: claude
---

# ADR 0009: Agents are first-class principals with delegation

Casebook's architecture decision record 0009, "Agents are first-class principals with delegation", kept in
`docs/decisions/0009-agents-as-principals.md` and listed in the decision log `docs/decisions/README.md`.
Status: Accepted

What it decides, condensed from its Decision section: Agents are first-class principals. Users grant delegations to agents, scoped by namespace, case, role and expiry. An agent's effective authority is the intersection of its grants and the delegating user's bindings. Every event records `actor` and `on_behalf_of`; each action is on behalf of exactly one user or one group. Unattended agents act for an owning service principal. Steps marked `actor: human` cannot be completed by agents.

Captured from the ADR file during docket's initial scan; the ADR itself is
the authority for context and consequences.
