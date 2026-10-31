---
id: model.claude-sonnet-5
type: model
title: "Claude Sonnet 5"
attributes:
  modelId: "claude-sonnet-5"
  provider: "anthropic"
  purpose: "spreadsheet wizard authoring agent (opt-in)"

links:
  - rel: provided_by
    target: organization.anthropic
    evidence:
      - source: code
        path: packages/wizard-agent/src/model.ts
        lines: 5
        symbol: "anthropic:claude-sonnet-5"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/packages/wizard-agent/src/model.ts#L5
        observedAt: 2026-10-31
        observedBy: claude


evidence:
  - source: code
    path: packages/wizard-agent/src/model.ts
    lines: 5
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/packages/wizard-agent/src/model.ts#L5
    observedAt: 2026-10-31
    observedBy: claude
  - source: config
    path: .env.example
    lines: 18-22
    symbol: "CASEBOOK_WIZARD_MODEL"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/.env.example#L18-L22
    observedAt: 2026-10-31
    observedBy: claude
  - source: docs
    path: docs/decisions/0029-a-fast-wizard-on-claude.md
    lines: 1-15
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/docs/decisions/0029-a-fast-wizard-on-claude.md#L1-L15
    observedAt: 2026-10-31
    observedBy: claude

provenance:
  capturedBy: claude
---

# Claude Sonnet 5

The hosted model the wizard is tuned to be fast on (ADR 0029):
`CASEBOOK_WIZARD_MODEL=anthropic:claude-sonnet-5` with `ANTHROPIC_API_KEY`.
Claude models run at a low effort; on the sample workbook the split appears in
about 7 seconds and a first draft in under 35. Opt-in; not the default.
