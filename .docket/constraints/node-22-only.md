---
id: constraint.node-22-only
type: constraint
title: "Node 22 only, engine-strict"

links:
  - rel: governs
    target: repository.casebook
    evidence:
      - source: manifest
        path: package.json
        lines: 6-8
        symbol: "engines.node"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/package.json#L6-L8
        observedAt: 2026-10-31
        observedBy: claude


evidence:
  - source: manifest
    path: package.json
    lines: 6-8
    symbol: "engines.node"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/package.json#L6-L8
    observedAt: 2026-10-31
    observedBy: claude
  - source: config
    path: .npmrc
    lines: 1
    symbol: "engine-strict"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/.npmrc#L1
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

provenance:
  capturedBy: claude
---

# Node 22 only, engine-strict

`package.json` requires Node `>=22.12.0 <23` and `.npmrc` sets `engine-strict=true`, so pnpm refuses to run under another Node; `.prototools` pins Node 22.22.0, moon 2.6.4 and pnpm 10.28.2.
