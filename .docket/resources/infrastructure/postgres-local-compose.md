---
id: infrastructure.postgres-local-compose
type: infrastructure
title: "Local Postgres container (docker compose)"

evidence:
  - source: infrastructure
    path: docker-compose.yml
    lines: 1-19
    symbol: "services.postgres"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/docker-compose.yml#L1-L19
    observedAt: 2026-10-31
    observedBy: claude
  - source: manifest
    path: package.json
    lines: 18-20
    symbol: "scripts.db:up"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/package.json#L18-L20
    observedAt: 2026-10-31
    observedBy: claude

provenance:
  capturedBy: claude
---

# Local Postgres container (docker compose)

The Docker Compose `postgres` service developers start with `pnpm db:up`
(`docker compose up -d --wait postgres`) and stop with `pnpm db:down`; its data
persists in the `casebook-pgdata` volume until `docker compose down -v`.
