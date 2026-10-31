---
id: agent.spreadsheet-wizard
type: agent
title: "Spreadsheet wizard agent"
attributes:
  package: "@casebook/wizard-agent"
  runtime: "deepagents (LangChain JS) in the web app process"
  modes:
    - "split"
    - "draft"

links:
  - rel: depends_on
    target: library.sheet-import
    evidence:
      - source: manifest
        path: packages/wizard-agent/package.json
        lines: 18
        symbol: "dependencies.@casebook/sheet-import"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/packages/wizard-agent/package.json#L18
        observedAt: 2026-10-31
        observedBy: claude

  - rel: depends_on
    target: library.store
    evidence:
      - source: manifest
        path: packages/wizard-agent/package.json
        lines: 19
        symbol: "dependencies.@casebook/store"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/packages/wizard-agent/package.json#L19
        observedAt: 2026-10-31
        observedBy: claude

  - rel: depends_on
    target: library.model
    evidence:
      - source: manifest
        path: packages/wizard-agent/package.json
        lines: 17
        symbol: "dependencies.@casebook/model"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/packages/wizard-agent/package.json#L17
        observedAt: 2026-10-31
        observedBy: claude

  - rel: depends_on
    target: model.ollama-qwen2-5-7b
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

  - rel: depends_on
    target: model.claude-sonnet-5
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
      - source: docs
        path: README.md
        symbol: "Spreadsheet wizard"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/README.md
        observedAt: 2026-10-31
        observedBy: claude

  - rel: depends_on
    target: secret.anthropic-api-key
    evidence:
      - source: code
        path: packages/wizard-agent/src/model.ts
        lines: 139-140
        symbol: "ANTHROPIC_API_KEY"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/packages/wizard-agent/src/model.ts#L139-L140
        observedAt: 2026-10-31
        observedBy: claude

  - rel: depends_on
    target: secret.openai-api-key
    evidence:
      - source: code
        path: packages/wizard-agent/src/model.ts
        lines: 7
        symbol: "OPENAI_API_KEY"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/packages/wizard-agent/src/model.ts#L7
        observedAt: 2026-10-31
        observedBy: claude

  - rel: documented_in
    target: architecture_record.adr-0029
    evidence:
      - source: docs
        path: packages/wizard-agent/README.md
        lines: 5-12
        symbol: "How it works"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/packages/wizard-agent/README.md#L5-L12
        observedAt: 2026-10-31
        observedBy: claude


evidence:
  - source: manifest
    path: packages/wizard-agent/package.json
    lines: 1-37
    symbol: "@casebook/wizard-agent"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/packages/wizard-agent/package.json#L1-L37
    observedAt: 2026-10-31
    observedBy: claude
    note: "deepagents 1.15, langchain 1.5, @langchain/anthropic, ollama and openai."
  - source: code
    path: packages/wizard-agent/src/agent.ts
    lines: 26
    symbol: "createDeepAgent"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/packages/wizard-agent/src/agent.ts#L26
    observedAt: 2026-10-31
    observedBy: claude
  - source: docs
    path: packages/wizard-agent/README.md
    lines: 1-12
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/packages/wizard-agent/README.md#L1-L12
    observedAt: 2026-10-31
    observedBy: claude

provenance:
  capturedBy: claude
---

# Spreadsheet wizard agent

The authoring agent behind **New → Import a spreadsheet** (ADRs 0011, 0024,
0029), in `@casebook/wizard-agent`. Built on `deepagents` (LangChain/LangGraph),
it is shown a workbook read by `@casebook/sheet-import`, proposes how to split
it into processes, then drafts each process as node operations. It only
proposes: each `apply_operations` call is previewed through `DraftAccess`,
checked by the store as an edit by the signed-in person, and a person accepts
or rejects each proposal. Progress streams to the panel as it works.

The chat model is `CASEBOOK_WIZARD_MODEL` (`provider:model`, default
`ollama:qwen2.5:7b`; `anthropic:claude-sonnet-5` for Claude, `openai:` also
supported). A turn is stopped after `CASEBOOK_WIZARD_TIMEOUT_SECONDS`
(default 480).
