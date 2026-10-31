---
id: secret.openai-api-key
type: secret
title: "OPENAI_API_KEY"
attributes:
  store: ".env environment variable"

evidence:
  - source: config
    path: .env.example
    lines: 27-28
    symbol: "OPENAI_API_KEY"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/.env.example#L27-L28
    observedAt: 2026-10-31
    observedBy: claude
  - source: code
    path: packages/wizard-agent/src/model.ts
    lines: 7
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/packages/wizard-agent/src/model.ts#L7
    observedAt: 2026-10-31
    observedBy: claude

provenance:
  capturedBy: claude
---

# OPENAI_API_KEY

API key for `openai:` wizard models (with `OPENAI_BASE_URL` for compatible
servers). Optional; set in the root `.env`.
