---
id: architecture_record.adr-0013
type: architecture_record
title: "ADR 0013: Graph default view and wizard layout"

tags:
  - adr

attributes:
  number: 13
  path: docs/decisions/0013-graph-view-and-wizard-layout.md
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
    path: docs/decisions/0013-graph-view-and-wizard-layout.md
    lines: 1-32
    symbol: "0013. Graph default view and wizard layout"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/docs/decisions/0013-graph-view-and-wizard-layout.md
    observedAt: 2026-10-31
    observedBy: claude
    note: "ADR file with status line 'Accepted'."

provenance:
  capturedBy: claude
---

# ADR 0013: Graph default view and wizard layout

Casebook's architecture decision record 0013, "Graph default view and wizard layout", kept in
`docs/decisions/0013-graph-view-and-wizard-layout.md` and listed in the decision log `docs/decisions/README.md`.
Status: Accepted

What it decides, condensed from its Decision section: The editor is definition-editing mode only, with no cases or instances. Step cards (A) is the default view. Role lanes (B) and fact flow (C) are switchable views, alongside the process map with shared fact types. Clicking a node opens a definition inspector, not a form. The wizard layout is deferred to phase 2. Its prototype layouts stay as reference. Run time will be a per-user task list showing one form per task, with a light progress indicator rather than the full graph.

Captured from the ADR file during docket's initial scan; the ADR itself is
the authority for context and consequences.
