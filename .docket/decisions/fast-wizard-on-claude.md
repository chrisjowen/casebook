---
id: decision.fast-wizard-on-claude
type: decision
title: "A fast wizard on Claude, shown as it works"

links:
  - rel: documented_in
    target: architecture_record.adr-0029
    evidence:
      - source: docs
        path: docs/decisions/README.md
        symbol: "0029"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/docs/decisions/README.md
        observedAt: 2026-10-31
        observedBy: claude


evidence:
  - source: docs
    path: docs/decisions/0029-a-fast-wizard-on-claude.md
    symbol: "Decision"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/docs/decisions/0029-a-fast-wizard-on-claude.md
    observedAt: 2026-10-31
    observedBy: claude

provenance:
  capturedBy: claude
---

# A fast wizard on Claude, shown as it works

The wizard is tuned to run fast on Claude (low effort, the workbook in the conversation) and streams what it is doing, its words and its proposals to the panel as they arrive.
