---
id: system.github
type: system
title: "GitHub"
attributes:
  category: "source_control"
  vendor: "GitHub"

evidence:
  - source: config
    path: .moon/workspace.yml
    lines: 7-10
    symbol: "vcs.provider"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/.moon/workspace.yml#L7-L10
    observedAt: 2026-10-31
    observedBy: claude

provenance:
  capturedBy: claude
---

# GitHub

Hosts the repository (`chrisjowen/casebook`) and runs CI on GitHub Actions.
