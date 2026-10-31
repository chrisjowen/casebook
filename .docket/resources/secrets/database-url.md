---
id: secret.database-url
type: secret
title: "DATABASE_URL"
attributes:
  store: ".env (gitignored) / casebook-db Secret / CI env"

evidence:
  - source: config
    path: .env.example
    lines: 1-2
    symbol: "DATABASE_URL"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/.env.example#L1-L2
    observedAt: 2026-10-31
    observedBy: claude
  - source: config
    path: packages/store/drizzle.config.ts
    lines: 11-13
    symbol: "DATABASE_URL"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/packages/store/drizzle.config.ts#L11-L13
    observedAt: 2026-10-31
    observedBy: claude

provenance:
  capturedBy: claude
---

# DATABASE_URL

The Postgres connection string, which carries credentials. Read from the
repository-root `.env` (copied from `.env.example`) by the store's Drizzle
config, the seed and the MCP server; from the `casebook-db` Secret on k8s; and
set in the CI workflow env for the Postgres service container.
