---
id: model.ollama-qwen2-5-7b
type: model
title: "qwen2.5:7b on Ollama"
attributes:
  modelId: "qwen2.5:7b"
  provider: "ollama"
  purpose: "spreadsheet wizard authoring agent (default)"

links:
  - rel: hosted_on
    target: system.ollama
    evidence:
      - source: code
        path: packages/wizard-agent/src/model.ts
        lines: 6
        symbol: "ollama:qwen2.5:7b"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/packages/wizard-agent/src/model.ts#L6
        observedAt: 2026-10-31
        observedBy: claude


evidence:
  - source: code
    path: packages/wizard-agent/src/model.ts
    lines: 16-17
    symbol: "DEFAULT_MODEL"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/packages/wizard-agent/src/model.ts#L16-L17
    observedAt: 2026-10-31
    observedBy: claude
  - source: config
    path: .env.example
    lines: 20
    symbol: "CASEBOOK_WIZARD_MODEL"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/.env.example#L20
    observedAt: 2026-10-31
    observedBy: claude
  - source: infrastructure
    path: deploy/k8s/config.yaml
    lines: 29-31
    symbol: "CASEBOOK_WIZARD_MODEL"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/deploy/k8s/config.yaml#L29-L31
    observedAt: 2026-10-31
    observedBy: claude

provenance:
  capturedBy: claude
---

# qwen2.5:7b on Ollama

The wizard's default chat model: `qwen2.5:7b` on a local Ollama at
`OLLAMA_BASE_URL` (http://127.0.0.1:11434 unless set; on the k3d cluster
`http://host.k3d.internal:11434`). Slower and proposes less than a hosted
model; the wizard runs one turn at a time on Ollama.
