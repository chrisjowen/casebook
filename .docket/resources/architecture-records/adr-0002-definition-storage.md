---
id: architecture_record.adr-0002
type: architecture_record
title: "ADR 0002: Process definitions are canonical JSONB in Postgres"

tags:
  - adr

attributes:
  number: 2
  path: docs/decisions/0002-definition-storage.md
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
    path: docs/decisions/0002-definition-storage.md
    lines: 1-20
    symbol: "0002. Process definitions are canonical JSONB in Postgres"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/docs/decisions/0002-definition-storage.md
    observedAt: 2026-10-31
    observedBy: claude
    note: "ADR file with status line 'Accepted'."

provenance:
  capturedBy: claude
---

# ADR 0002: Process definitions are canonical JSONB in Postgres

Casebook's architecture decision record 0002, "Process definitions are canonical JSONB in Postgres", kept in
`docs/decisions/0002-definition-storage.md` and listed in the decision log `docs/decisions/README.md`.
Status: Accepted

What it decides, condensed from its Decision section: Postgres is canonical. A published definition version is an immutable JSONB document validated against a versioned process-definition JSON Schema. Drafts are revisions of the same shape. Cases pin to a definition version, or follow the latest under a living change policy (0016). Markdown (front matter plus body), BPMN and the graph are projections generated from the document. Git sync is an optional later integration.

Captured from the ADR file during docket's initial scan; the ADR itself is
the authority for context and consequences.
