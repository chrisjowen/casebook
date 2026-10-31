---
id: architecture_record.adr-0003
type: architecture_record
title: "ADR 0003: Node model: core, content and data"

tags:
  - adr

attributes:
  number: 3
  path: docs/decisions/0003-node-model.md
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
    path: docs/decisions/0003-node-model.md
    lines: 1-50
    symbol: "0003. Node model: core, content and data"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/docs/decisions/0003-node-model.md
    observedAt: 2026-10-31
    observedBy: claude
    note: "ADR file with status line 'Accepted'."

provenance:
  capturedBy: claude
---

# ADR 0003: Node model: core, content and data

Casebook's architecture decision record 0003, "Node model: core, content and data", kept in
`docs/decisions/0003-node-model.md` and listed in the decision log `docs/decisions/README.md`.
Status: Accepted

What it decides, condensed from its Decision section: Every element (process, stage, step, fact, role, decision, approval) is a node with three layers: core: typed and schema-validated. Identity, kind, edges (requires, collects, stage membership), role, actor policy (`human`, `agent` or `either`), guards, source reference with an `inferred` flag, and invariants. content: Markdown prose guidance for people. data: an open map with namespaced keys (`bpmn.*`, `excel.*`, `ui.*`, `hooks.*`) for projections and extensions. Edges live on nodes; the graph is derived. Proven extensions in `data` are promoted into `core` with a schema version bump. Illustrative step node (incident management): ```json { "core": { "id": "step.form-working-group", "kind": …

Captured from the ADR file during docket's initial scan; the ADR itself is
the authority for context and consequences.
