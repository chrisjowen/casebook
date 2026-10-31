---
id: repository.casebook
type: repository
title: "casebook repository"
attributes:
  defaultBranch: "main"
  url: "https://github.com/chrisjowen/casebook"

links:
  - rel: contains
    target: service.web
    evidence:
      - source: docs
        path: README.md
        symbol: "Repository layout"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/README.md
        observedAt: 2026-10-31
        observedBy: claude
        note: "apps/web is the SvelteKit runner and definition editor."

  - rel: contains
    target: service.mcp
    evidence:
      - source: docs
        path: README.md
        symbol: "Repository layout"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/README.md
        observedAt: 2026-10-31
        observedBy: claude
        note: "packages/mcp is the MCP server for agents."

  - rel: contains
    target: library.model
    evidence:
      - source: manifest
        path: packages/model/package.json
        lines: 2
        symbol: "name"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/packages/model/package.json#L2
        observedAt: 2026-10-31
        observedBy: claude

  - rel: contains
    target: library.store
    evidence:
      - source: manifest
        path: packages/store/package.json
        lines: 2
        symbol: "name"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/packages/store/package.json#L2
        observedAt: 2026-10-31
        observedBy: claude

  - rel: contains
    target: library.sheet-import
    evidence:
      - source: manifest
        path: packages/sheet-import/package.json
        lines: 2
        symbol: "name"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/packages/sheet-import/package.json#L2
        observedAt: 2026-10-31
        observedBy: claude

  - rel: contains
    target: agent.spreadsheet-wizard
    evidence:
      - source: manifest
        path: packages/wizard-agent/package.json
        lines: 2
        symbol: "name"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/packages/wizard-agent/package.json#L2
        observedAt: 2026-10-31
        observedBy: claude

  - rel: contains
    target: pipeline.ci
    evidence:
      - source: infrastructure
        path: .github/workflows/ci.yml
        lines: 1-58
        symbol: "CI"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/.github/workflows/ci.yml#L1-L58
        observedAt: 2026-10-31
        observedBy: claude

  - rel: contains
    target: pipeline.local-deploy
    evidence:
      - source: config
        path: .wheelhouse.yaml
        lines: 1-31
        symbol: "checks.local-deploy"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/.wheelhouse.yaml#L1-L31
        observedAt: 2026-10-31
        observedBy: claude

  - rel: contains
    target: document.glossary
    evidence:
      - source: docs
        path: README.md
        symbol: "Docs"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/README.md
        observedAt: 2026-10-31
        observedBy: claude
        note: "Linked from the README Docs section."

  - rel: contains
    target: document.roadmap
    evidence:
      - source: docs
        path: README.md
        symbol: "Docs"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/README.md
        observedAt: 2026-10-31
        observedBy: claude
        note: "Linked from the README Docs section."


evidence:
  - source: config
    path: .moon/workspace.yml
    lines: 1-10
    symbol: "vcs"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/.moon/workspace.yml#L1-L10
    observedAt: 2026-10-31
    observedBy: claude
    note: "moon workspace over apps/* and packages/*, GitHub provider, default branch main."
  - source: manifest
    path: pnpm-workspace.yaml
    lines: 1-6
    symbol: "packages"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/pnpm-workspace.yaml#L1-L6
    observedAt: 2026-10-31
    observedBy: claude
  - source: docs
    path: README.md
    symbol: "Repository layout"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/README.md
    observedAt: 2026-10-31
    observedBy: claude
    note: "README table of apps/web, the five packages and deploy."

provenance:
  capturedBy: claude
---

# casebook repository

The casebook monorepo on GitHub (`chrisjowen/casebook`, default branch `main`):
a generic process modeler and runner for human-in-the-loop processes run as
cases. It is a moon workspace over pnpm workspaces, all TypeScript, with one
app (`apps/web`) and five packages (`model`, `store`, `mcp`, `sheet-import`,
`wizard-agent`), Kubernetes manifests under `deploy/`, and 29 ADRs under
`docs/decisions/`.

No CODEOWNERS file or team is declared in the repository, so no owner is
recorded yet.
