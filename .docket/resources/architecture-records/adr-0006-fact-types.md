---
id: architecture_record.adr-0006
type: architecture_record
title: "ADR 0006: Fact types are JSON Schema with extensions"

tags:
  - adr

attributes:
  number: 6
  path: docs/decisions/0006-fact-types.md
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
    path: docs/decisions/0006-fact-types.md
    lines: 1-23
    symbol: "0006. Fact types are JSON Schema with extensions"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/docs/decisions/0006-fact-types.md
    observedAt: 2026-10-31
    observedBy: claude
    note: "ADR file with status line 'Accepted'."

provenance:
  capturedBy: claude
---

# ADR 0006: Fact types are JSON Schema with extensions

Casebook's architecture decision record 0006, "Fact types are JSON Schema with extensions", kept in
`docs/decisions/0006-fact-types.md` and listed in the decision log `docs/decisions/README.md`.
Status: Accepted

What it decides, condensed from its Decision section: Fact types are JSON Schema 2020-12 plus extensions: `x-lookup`: reference datasets, principals filtered by role, other facts or cases, later external connectors. `x-evidence`: required proof, including format and copy count. `x-sensitivity`: PII levels. Shared types live in a namespace-level type library reused via `$ref`. Reference datasets are namespace-level and versioned. Forms render from the schema, with layout hints in `data.ui.*`.

Captured from the ADR file during docket's initial scan; the ADR itself is
the authority for context and consequences.
