---
id: library.model
type: library
title: "@casebook/model"
attributes:
  language: "TypeScript"
  package: "@casebook/model"

evidence:
  - source: manifest
    path: packages/model/package.json
    lines: 1-30
    symbol: "@casebook/model"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/packages/model/package.json#L1-L30
    observedAt: 2026-10-31
    observedBy: claude
    note: "Only runtime dependency is ajv."
  - source: docs
    path: README.md
    symbol: "Repository layout"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/README.md
    observedAt: 2026-10-31
    observedBy: claude

provenance:
  capturedBy: claude
---

# @casebook/model

Pure TypeScript package with the process-definition types and JSON Schema
(`schema/process-definition.schema.json`), validation (ajv), publish checks,
node operations, conditions/guards, lookups and the case runtime's pure logic,
including the condition expression language
(`src/runtime/expression.ts`). Every other package builds on it; it has no
I/O and no internal dependencies.
