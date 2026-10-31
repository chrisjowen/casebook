---
id: architecture_record.adr-0010
type: architecture_record
title: "ADR 0010: Lifecycle event names reserved for hooks"

tags:
  - adr

attributes:
  number: 10
  path: docs/decisions/0010-reserved-lifecycle-events.md
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
    path: docs/decisions/0010-reserved-lifecycle-events.md
    lines: 1-16
    symbol: "0010. Lifecycle event names reserved for hooks"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/docs/decisions/0010-reserved-lifecycle-events.md
    observedAt: 2026-10-31
    observedBy: claude
    note: "ADR file with status line 'Accepted'."

provenance:
  capturedBy: claude
---

# ADR 0010: Lifecycle event names reserved for hooks

Casebook's architecture decision record 0010, "Lifecycle event names reserved for hooks", kept in
`docs/decisions/0010-reserved-lifecycle-events.md` and listed in the decision log `docs/decisions/README.md`.
Status: Accepted

What it decides, condensed from its Decision section: Lifecycle event names are reserved now: `case.opened`, `fact.recorded`, `step.completed`, `decision.made`, and similar. Nodes may carry hook bindings in `data.hooks.*`. Nothing executes them in v1.

Captured from the ADR file during docket's initial scan; the ADR itself is
the authority for context and consequences.
