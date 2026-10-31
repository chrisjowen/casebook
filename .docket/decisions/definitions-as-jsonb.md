---
id: decision.definitions-as-jsonb
type: decision
title: "Process definitions are canonical JSONB in Postgres"

links:
  - rel: documented_in
    target: architecture_record.adr-0002
    evidence:
      - source: docs
        path: docs/decisions/README.md
        symbol: "0002"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/docs/decisions/README.md
        observedAt: 2026-10-31
        observedBy: claude


evidence:
  - source: docs
    path: docs/decisions/0002-definition-storage.md
    symbol: "Decision"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/docs/decisions/0002-definition-storage.md
    observedAt: 2026-10-31
    observedBy: claude

provenance:
  capturedBy: claude
---

# Process definitions are canonical JSONB in Postgres

Process definitions are stored as canonical JSONB documents in Postgres, validated against the model's JSON Schema.
