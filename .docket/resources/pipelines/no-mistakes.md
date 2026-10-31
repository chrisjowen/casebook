---
id: pipeline.no-mistakes
type: pipeline
title: "no-mistakes gate"
attributes:
  path: ".no-mistakes.yaml"
  provider: "no-mistakes"

links:
  - rel: defined_in
    target: repository.casebook
    evidence:
      - source: config
        path: .no-mistakes.yaml
        lines: 1-9
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/.no-mistakes.yaml#L1-L9
        observedAt: 2026-10-31
        observedBy: claude


evidence:
  - source: config
    path: .no-mistakes.yaml
    lines: 1-9
    symbol: "commands.test"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/.no-mistakes.yaml#L1-L9
    observedAt: 2026-10-31
    observedBy: claude

provenance:
  capturedBy: claude
---

# no-mistakes gate

Per-repo overrides for the no-mistakes pipeline: its test pass runs
`pnpm install --frozen-lockfile && pnpm exec moon run wizard-agent:test web:test`
with local stubs, never a live model.
