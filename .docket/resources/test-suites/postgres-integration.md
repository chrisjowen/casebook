---
id: test_suite.postgres-integration
type: test_suite
title: "Postgres-backed integration tests"
attributes:
  framework: "vitest"
  kind: "integration"

links:
  - rel: tests
    target: library.store
    evidence:
      - source: config
        path: packages/store/moon.yml
        lines: 37-40
        symbol: "tasks.test"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/packages/store/moon.yml#L37-L40
        observedAt: 2026-10-31
        observedBy: claude

  - rel: tests
    target: service.mcp
    evidence:
      - source: config
        path: packages/mcp/vitest.config.ts
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/packages/mcp/vitest.config.ts
        observedAt: 2026-10-31
        observedBy: claude

  - rel: uses
    target: datasource.postgres
    evidence:
      - source: docs
        path: README.md
        symbol: "Checks"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/README.md
        observedAt: 2026-10-31
        observedBy: claude


evidence:
  - source: docs
    path: README.md
    symbol: "Checks"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/README.md
    observedAt: 2026-10-31
    observedBy: claude
  - source: infrastructure
    path: .github/workflows/ci.yml
    lines: 15-33
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/.github/workflows/ci.yml#L15-L33
    observedAt: 2026-10-31
    observedBy: claude

provenance:
  capturedBy: claude
---

# Postgres-backed integration tests

The `store` tests (seed, editing, publishing, running cases, permission
refusals), the `mcp` tests (tools and OAuth sign-in) and the store-backed
`wizard-agent` tests need Postgres: they migrate a throwaway database next to
the one `DATABASE_URL` names, and are skipped when it is unset outside CI.
