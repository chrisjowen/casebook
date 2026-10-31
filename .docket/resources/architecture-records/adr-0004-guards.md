---
id: architecture_record.adr-0004
type: architecture_record
title: "ADR 0004: Guards start loose"

tags:
  - adr

attributes:
  number: 4
  path: docs/decisions/0004-guards.md
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
    path: docs/decisions/0004-guards.md
    lines: 1-17
    symbol: "0004. Guards start loose"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/docs/decisions/0004-guards.md
    observedAt: 2026-10-31
    observedBy: claude
    note: "ADR file with status line 'Accepted'."

provenance:
  capturedBy: claude
---

# ADR 0004: Guards start loose

Casebook's architecture decision record 0004, "Guards start loose", kept in
`docs/decisions/0004-guards.md` and listed in the decision log `docs/decisions/README.md`.
Status: Accepted

What it decides, condensed from its Decision section: A guard is prose text plus an optional structured expression in a small safe language (CEL or JSONLogic style) over case facts and roles. With only prose, the engine surfaces an open decision to the responsible role rather than guessing. Repeating steps use an `until` condition.

Captured from the ADR file during docket's initial scan; the ADR itself is
the authority for context and consequences.
