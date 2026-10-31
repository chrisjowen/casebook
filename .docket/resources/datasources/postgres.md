---
id: datasource.postgres
type: datasource
title: "casebook Postgres database"
attributes:
  zone: "private"

links:
  - rel: hosted_on
    target: infrastructure.postgres-local-compose
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
    note: "postgres:17 on 127.0.0.1:${CASEBOOK_PG_PORT:-5433}."
  - source: infrastructure
    path: deploy/k8s/postgres.yaml
    lines: 1-60
    symbol: "StatefulSet/postgres"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/deploy/k8s/postgres.yaml#L1-L60
    observedAt: 2026-10-31
    observedBy: claude
  - source: infrastructure
    path: .github/workflows/ci.yml
    lines: 17-31
    symbol: "services.postgres"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/.github/workflows/ci.yml#L17-L31
    observedAt: 2026-10-31
    observedBy: claude
  - source: code
    path: packages/store/src/schema.ts
    lines: 1-646
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/packages/store/src/schema.ts#L1-L646
    observedAt: 2026-10-31
    observedBy: claude
  - source: docs
    path: docs/decisions/0002-definition-storage.md
    lines: 1-20
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/docs/decisions/0002-definition-storage.md#L1-L20
    observedAt: 2026-10-31
    observedBy: claude

provenance:
  capturedBy: claude
---

# casebook Postgres database

Postgres 17 database `casebook`, the system of record: definitions (canonical
JSONB, ADR 0002), drafts, cases, facts, events, permissions and wizard
sessions, through `@casebook/store`'s Drizzle schema and migrations.

- Local dev: the `postgres` service in `docker-compose.yml` on
  127.0.0.1:5433 (`CASEBOOK_PG_PORT`), data in the `casebook-pgdata` volume.
- Local k8s: the `postgres` StatefulSet with a 1Gi volume, credentials from
  the `casebook-db` Secret.
- CI: a `postgres:17` service container; store tests migrate a throwaway
  database next to the one `DATABASE_URL` names.

Connection is `DATABASE_URL` (see [[secret.database-url]]).
