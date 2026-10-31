---
id: library.store
type: library
title: "@casebook/store"
attributes:
  language: "TypeScript"
  package: "@casebook/store"

links:
  - rel: depends_on
    target: library.model
    evidence:
      - source: manifest
        path: packages/store/package.json
        lines: 23
        symbol: "dependencies.@casebook/model"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/packages/store/package.json#L23
        observedAt: 2026-10-31
        observedBy: claude

  - rel: depends_on
    target: datasource.postgres
    evidence:
      - source: manifest
        path: packages/store/package.json
        lines: 24-25
        symbol: "dependencies.drizzle-orm, postgres"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/packages/store/package.json#L24-L25
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

  - rel: depends_on
    target: datasource.case-files
    evidence:
      - source: code
        path: packages/store/src/files.ts
        lines: 73-75
        symbol: "filesDirectory"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/packages/store/src/files.ts#L73-L75
        observedAt: 2026-10-31
        observedBy: claude


evidence:
  - source: manifest
    path: packages/store/package.json
    lines: 1-33
    symbol: "@casebook/store"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/packages/store/package.json#L1-L33
    observedAt: 2026-10-31
    observedBy: claude
    note: "drizzle-orm 0.45 and postgres 3.4."
  - source: code
    path: packages/store/src/schema.ts
    lines: 1-646
    symbol: "pgTable"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/packages/store/src/schema.ts#L1-L646
    observedAt: 2026-10-31
    observedBy: claude
  - source: code
    path: packages/store/src/authz.ts
    lines: 255
    symbol: "can"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/packages/store/src/authz.ts#L255
    observedAt: 2026-10-31
    observedBy: claude

provenance:
  capturedBy: claude
---

# @casebook/store

Postgres persistence for casebook (`packages/store`): Drizzle ORM schema and
migrations (`src/schema.ts`, `drizzle/`), the permission check `can()` in
`src/authz.ts`, definition editing (draft revisions, publish, undo), the case
runtime, shared lookups, wizard sessions, local-disk case files
(`src/files.ts`) and the synthetic demo seed (`src/seed.ts`, run as
`pnpm db:seed` or the k8s setup Job).

Tables include accounts, namespaces, principals, process definitions and
versions, draft revisions, cases and their events, facts and files, role
bindings, delegation grants, wizard sessions and shared lookups.
