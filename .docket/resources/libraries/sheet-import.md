---
id: library.sheet-import
type: library
title: "@casebook/sheet-import"
attributes:
  language: "TypeScript"
  package: "@casebook/sheet-import"

evidence:
  - source: manifest
    path: packages/sheet-import/package.json
    lines: 1-24
    symbol: "@casebook/sheet-import"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/packages/sheet-import/package.json#L1-L24
    observedAt: 2026-10-31
    observedBy: claude
    note: "Depends on xlsx from cdn.sheetjs.com."
  - source: docs
    path: packages/sheet-import/README.md
    lines: 1-6
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/packages/sheet-import/README.md#L1-L6
    observedAt: 2026-10-31
    observedBy: claude

provenance:
  capturedBy: claude
---

# @casebook/sheet-import

Reads an `.xlsx` workbook into a neutral, JSON-serializable model of sheets,
regions, rows, merged ranges and cells, each with a source reference (sheet
plus A1 address), and renders it as compact addressed text for an LLM. A pure
library: takes bytes, does no I/O. Uses SheetJS (`xlsx` 0.20.3 from the
SheetJS CDN tarball). Consumed by the wizard agent and the web app.
