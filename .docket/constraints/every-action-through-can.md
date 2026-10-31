---
id: constraint.every-action-through-can
type: constraint
title: "Every read and write goes through can()"

links:
  - rel: governs
    target: repository.casebook
    evidence:
      - source: code
        path: packages/store/src/authz.ts
        lines: 255
        symbol: "can"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/packages/store/src/authz.ts#L255
        observedAt: 2026-10-31
        observedBy: claude


evidence:
  - source: code
    path: packages/store/src/authz.ts
    lines: 255
    symbol: "can"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/packages/store/src/authz.ts#L255
    observedAt: 2026-10-31
    observedBy: claude
  - source: docs
    path: README.md
    symbol: "Spreadsheet wizard"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/README.md
    observedAt: 2026-10-31
    observedBy: claude

provenance:
  capturedBy: claude
---

# Every read and write goes through can()

Every read and write acts as the signed-in user (or the agent acting for them) and goes through the store's `can()`; actions a user cannot take are disabled with the reason. Approvals and human-only steps are refused to agents.
