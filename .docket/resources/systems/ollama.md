---
id: system.ollama
type: system
title: "Ollama"
attributes:
  category: "llm"
  vendor: "Ollama"

evidence:
  - source: config
    path: .env.example
    lines: 23-24
    symbol: "OLLAMA_BASE_URL"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/.env.example#L23-L24
    observedAt: 2026-10-31
    observedBy: claude
  - source: infrastructure
    path: deploy/k8s/config.yaml
    lines: 30-31
    symbol: "OLLAMA_BASE_URL"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/deploy/k8s/config.yaml#L30-L31
    observedAt: 2026-10-31
    observedBy: claude

provenance:
  capturedBy: claude
---

# Ollama

A local LLM server the wizard's default model runs on, outside the repository:
on the developer's machine at http://127.0.0.1:11434, reached from the k3d
cluster through `host.k3d.internal`. Pull the model first with
`ollama pull qwen2.5:7b`.
