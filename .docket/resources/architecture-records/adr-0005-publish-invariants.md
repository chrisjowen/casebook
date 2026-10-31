---
id: architecture_record.adr-0005
type: architecture_record
title: "ADR 0005: Publish-time invariant checks"

tags:
  - adr

attributes:
  number: 5
  path: docs/decisions/0005-publish-invariants.md
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
    path: docs/decisions/0005-publish-invariants.md
    lines: 1-19
    symbol: "0005. Publish-time invariant checks"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/docs/decisions/0005-publish-invariants.md
    observedAt: 2026-10-31
    observedBy: claude
    note: "ADR file with status line 'Accepted'."

provenance:
  capturedBy: claude
---

# ADR 0005: Publish-time invariant checks

Casebook's architecture decision record 0005, "Publish-time invariant checks", kept in
`docs/decisions/0005-publish-invariants.md` and listed in the decision log `docs/decisions/README.md`.
Status: Accepted

What it decides, condensed from its Decision section: Publishing a definition runs invariant checks: no dependency cycles; every required fact is collected somewhere; every role is declared; every guard expression references only known facts.

Captured from the ADR file during docket's initial scan; the ADR itself is
the authority for context and consequences.
