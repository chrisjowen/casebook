---
id: system.wheelhouse
type: system
title: "Wheelhouse"
attributes:
  category: "ci_cd"

evidence:
  - source: config
    path: .wheelhouse.yaml
    lines: 1-13
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/.wheelhouse.yaml#L1-L13
    observedAt: 2026-10-31
    observedBy: claude

provenance:
  capturedBy: claude
---

# Wheelhouse

The delivery tool whose passage for casebook (`.wheelhouse.yaml`) adds the
Deployed locally stage after merge (https://github.com/chrisjowen/wheelhouse).
