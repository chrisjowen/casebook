---
id: architecture_record.adr-0008
type: architecture_record
title: "ADR 0008: Principals, roles and role bindings"

tags:
  - adr

attributes:
  number: 8
  path: docs/decisions/0008-identity-and-roles.md
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
    path: docs/decisions/0008-identity-and-roles.md
    lines: 1-19
    symbol: "0008. Principals, roles and role bindings"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/docs/decisions/0008-identity-and-roles.md
    observedAt: 2026-10-31
    observedBy: claude
    note: "ADR file with status line 'Accepted'."

provenance:
  capturedBy: claude
---

# ADR 0008: Principals, roles and role bindings

Casebook's architecture decision record 0008, "Principals, roles and role bindings", kept in
`docs/decisions/0008-identity-and-roles.md` and listed in the decision log `docs/decisions/README.md`.
Status: Accepted

What it decides, condensed from its Decision section: Principals are users, groups and agents, keyed by OIDC-shaped `(issuer, subject)`, with one built-in issuer to start. Process roles are abstract slots in definitions. Role bindings exist at namespace level (standing) and case level (assigned at runtime, for example a working group produced by a step). Resolution order is case, then namespace, then parent namespace. Bindings are stored as Zanzibar-style `(principal, role, scope)` tuples.

Captured from the ADR file during docket's initial scan; the ADR itself is
the authority for context and consequences.
