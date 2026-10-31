---
id: architecture_record.adr-0014
type: architecture_record
title: "ADR 0014: Synthetic sample data only"

tags:
  - adr

attributes:
  number: 14
  path: docs/decisions/0014-synthetic-sample-data.md
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
    path: docs/decisions/0014-synthetic-sample-data.md
    lines: 1-15
    symbol: "0014. Synthetic sample data only"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/docs/decisions/0014-synthetic-sample-data.md
    observedAt: 2026-10-31
    observedBy: claude
    note: "ADR file with status line 'Accepted'."

provenance:
  capturedBy: claude
---

# ADR 0014: Synthetic sample data only

Casebook's architecture decision record 0014, "Synthetic sample data only", kept in
`docs/decisions/0014-synthetic-sample-data.md` and listed in the decision log `docs/decisions/README.md`.
Status: Accepted

What it decides, condensed from its Decision section: Sample data uses synthetic names and numbers only. Real personal spreadsheets are never committed.

Captured from the ADR file during docket's initial scan; the ADR itself is
the authority for context and consequences.
