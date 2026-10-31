---
id: secret.anthropic-api-key
type: secret
title: "ANTHROPIC_API_KEY"
attributes:
  store: ".env environment variable"

evidence:
  - source: config
    path: .env.example
    lines: 19-22
    symbol: "ANTHROPIC_API_KEY"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/.env.example#L19-L22
    observedAt: 2026-10-31
    observedBy: claude
  - source: code
    path: packages/wizard-agent/src/model.ts
    lines: 139-140
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/packages/wizard-agent/src/model.ts#L139-L140
    observedAt: 2026-10-31
    observedBy: claude

provenance:
  capturedBy: claude
---

# ANTHROPIC_API_KEY

API key for Claude, needed only when `CASEBOOK_WIZARD_MODEL` names an
`anthropic:` model. Set in the root `.env`; without it the wizard reports that
it cannot reach Claude.
