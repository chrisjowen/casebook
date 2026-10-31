---
id: environment.local-dev
type: environment
title: "Local development"
attributes:
  environmentType: "local"

evidence:
  - source: config
    path: .env.example
    lines: 1-31
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/.env.example#L1-L31
    observedAt: 2026-10-31
    observedBy: claude
  - source: config
    path: .prototools
    lines: 1-3
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/.prototools#L1-L3
    observedAt: 2026-10-31
    observedBy: claude
  - source: manifest
    path: package.json
    lines: 10-24
    symbol: "scripts"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/package.json#L10-L24
    observedAt: 2026-10-31
    observedBy: claude

provenance:
  capturedBy: claude
---

# Local development

A developer machine running `pnpm dev` (web on :5173), `pnpm dev:mcp` (MCP on
:5190) and the docker-compose Postgres on :5433, configured by a root `.env`
copied from `.env.example`. Toolchain pinned by `.prototools` (moon 2.6.4,
Node 22.22.0, pnpm 10.28.2), installed with proto.
