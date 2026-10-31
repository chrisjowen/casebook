---
id: test_suite.unit
type: test_suite
title: "Vitest suites"
attributes:
  framework: "vitest"
  kind: "unit"

links:
  - rel: tests
    target: library.model
    evidence:
      - source: config
        path: packages/model/vitest.config.ts
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/packages/model/vitest.config.ts
        observedAt: 2026-10-31
        observedBy: claude

  - rel: tests
    target: library.sheet-import
    evidence:
      - source: config
        path: packages/sheet-import/vitest.config.ts
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/packages/sheet-import/vitest.config.ts
        observedAt: 2026-10-31
        observedBy: claude

  - rel: tests
    target: agent.spreadsheet-wizard
    evidence:
      - source: config
        path: packages/wizard-agent/vitest.config.ts
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/packages/wizard-agent/vitest.config.ts
        observedAt: 2026-10-31
        observedBy: claude


evidence:
  - source: manifest
    path: package.json
    lines: 14
    symbol: "scripts.test"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/package.json#L14
    observedAt: 2026-10-31
    observedBy: claude
  - source: docs
    path: README.md
    symbol: "Checks"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/README.md
    observedAt: 2026-10-31
    observedBy: claude

provenance:
  capturedBy: claude
---

# Vitest suites

Each project has a Vitest suite run by `moon run :test` (`pnpm test`); moon
builds dependencies first. The wizard agent's tests use a scripted model;
`CASEBOOK_LIVE_AGENT=1 moon run wizard-agent:test` also runs one against the
configured model.
