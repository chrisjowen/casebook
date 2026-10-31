---
id: constraint.synthetic-sample-data-only
type: constraint
title: "Sample data is synthetic only"

links:
  - rel: governs
    target: repository.casebook
    evidence:
      - source: docs
        path: docs/decisions/0014-synthetic-sample-data.md
        lines: 1-16
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/docs/decisions/0014-synthetic-sample-data.md#L1-L16
        observedAt: 2026-10-31
        observedBy: claude


evidence:
  - source: docs
    path: docs/decisions/0014-synthetic-sample-data.md
    lines: 1-16
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/docs/decisions/0014-synthetic-sample-data.md#L1-L16
    observedAt: 2026-10-31
    observedBy: claude

provenance:
  capturedBy: claude
---

# Sample data is synthetic only

Fixtures and seed data use synthetic names and numbers only; real personal spreadsheets are never committed, and reviews should reject commits with real personal data (ADR 0014).
