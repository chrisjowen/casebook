---
id: organization.anthropic
type: organization
title: "Anthropic"

evidence:
  - source: manifest
    path: packages/wizard-agent/package.json
    lines: 20
    symbol: "dependencies.@langchain/anthropic"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/packages/wizard-agent/package.json#L20
    observedAt: 2026-10-31
    observedBy: claude

provenance:
  capturedBy: claude
---

# Anthropic

Provider of the Claude models the spreadsheet wizard can run on, reached with
`ANTHROPIC_API_KEY` through `@langchain/anthropic`.
