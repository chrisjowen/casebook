---
id: pipeline.ci
type: pipeline
title: "CI workflow"
attributes:
  path: ".github/workflows/ci.yml"
  provider: "github-actions"
  triggers:
    - "pull_request"

links:
  - rel: defined_in
    target: repository.casebook
    evidence:
      - source: infrastructure
        path: .github/workflows/ci.yml
        lines: 1-58
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/.github/workflows/ci.yml#L1-L58
        observedAt: 2026-10-31
        observedBy: claude

  - rel: depends_on
    target: datasource.postgres
    evidence:
      - source: infrastructure
        path: .github/workflows/ci.yml
        lines: 17-33
        symbol: "services.postgres"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/.github/workflows/ci.yml#L17-L33
        observedAt: 2026-10-31
        observedBy: claude

  - rel: uses
    target: system.github
    evidence:
      - source: infrastructure
        path: .github/workflows/ci.yml
        lines: 15
        symbol: "runs-on"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/.github/workflows/ci.yml#L15
        observedAt: 2026-10-31
        observedBy: claude


evidence:
  - source: infrastructure
    path: .github/workflows/ci.yml
    lines: 1-58
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/.github/workflows/ci.yml#L1-L58
    observedAt: 2026-10-31
    observedBy: claude

provenance:
  capturedBy: claude
---

# CI workflow

GitHub Actions workflow on pull requests: installs proto/moon/Node/pnpm with
`moonrepo/setup-toolchain`, `pnpm install --frozen-lockfile`, then
`moon run :check`, `:lint`, `pnpm format:check` and `moon run :test`, with a
Postgres 17 service container for the store-backed tests.
