---
id: decision.agents-over-mcp
type: decision
title: "Agents work cases over MCP, signed in as a user"

links:
  - rel: documented_in
    target: architecture_record.adr-0023
    evidence:
      - source: docs
        path: docs/decisions/README.md
        symbol: "0023"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/docs/decisions/README.md
        observedAt: 2026-10-31
        observedBy: claude


evidence:
  - source: docs
    path: docs/decisions/0023-agents-over-mcp.md
    symbol: "Decision"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/docs/decisions/0023-agents-over-mcp.md
    observedAt: 2026-10-31
    observedBy: claude

provenance:
  capturedBy: claude
---

# Agents work cases over MCP, signed in as a user

Agents reach casebook through `@casebook/mcp` over Streamable HTTP, signed in with OAuth as one person, acting only as that person can; every call goes through the store so `can()` decides it; there is no approval tool.
