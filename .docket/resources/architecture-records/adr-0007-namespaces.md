---
id: architecture_record.adr-0007
type: architecture_record
title: "ADR 0007: Hierarchical namespaces from day one"

tags:
  - adr

attributes:
  number: 7
  path: docs/decisions/0007-namespaces.md
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
    path: docs/decisions/0007-namespaces.md
    lines: 1-17
    symbol: "0007. Hierarchical namespaces from day one"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/docs/decisions/0007-namespaces.md
    observedAt: 2026-10-31
    observedBy: claude
    note: "ADR file with status line 'Accepted'."

provenance:
  capturedBy: claude
---

# ADR 0007: Hierarchical namespaces from day one

Casebook's architecture decision record 0007, "Hierarchical namespaces from day one", kept in
`docs/decisions/0007-namespaces.md` and listed in the decision log `docs/decisions/README.md`.
Status: Accepted

What it decides, condensed from its Decision section: Namespaces are hierarchical paths (for example `acme/eng/sre` or `personal/<user>/family`). Definitions, cases and role bindings carry a namespace from the first migration. We run a single deployment first and add row-level security when a second tenant arrives.

Captured from the ADR file during docket's initial scan; the ADR itself is
the authority for context and consequences.
