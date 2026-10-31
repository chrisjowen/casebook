---
id: architecture_record.adr-0022
type: architecture_record
title: "ADR 0022: Running cases"

tags:
  - adr

attributes:
  number: 22
  path: docs/decisions/0022-running-cases.md
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
    path: docs/decisions/0022-running-cases.md
    lines: 1-25
    symbol: "0022. Running cases"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/docs/decisions/0022-running-cases.md
    observedAt: 2026-10-31
    observedBy: claude
    note: "ADR file with status line 'Accepted. Amends 0016 and 0017.'."

provenance:
  capturedBy: claude
---

# ADR 0022: Running cases

Casebook's architecture decision record 0022, "Running cases", kept in
`docs/decisions/0022-running-cases.md` and listed in the decision log `docs/decisions/README.md`.
Status: Accepted. Amends 0016 and 0017.

What it decides, condensed from its Decision section: Processes attach to a case. A case is the subject (0001) and holds no version; each attached process is bound to a published version, pinned or following, under 0016's rules, which now apply per attachment. A case may run the same definition more than once, told apart by a label. Runtime state is an event log. Every change is a case event named with the reserved lifecycle events (0010), plus `step.held` and `step.resumed` for pausing, and records its actor and who they acted for (0009). Facts are rows that point at their `fact.recorded` event; the newest row is the value, and every process on the case shares it. Files live in a file store, local disk for now, behind a small interface; a …

Its status line relates it to earlier records: [[architecture_record.adr-0016]], [[architecture_record.adr-0017]] ("Accepted. Amends 0016 and 0017.").

Captured from the ADR file during docket's initial scan; the ADR itself is
the authority for context and consequences.
