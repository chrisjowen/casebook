---
id: endpoint.mcp-dev
type: endpoint
title: "MCP server (dev)"
attributes:
  url: "http://localhost:5190/mcp"
  visibility: "private"

evidence:
  - source: code
    path: packages/mcp/src/cli/serve.ts
    lines: 27-30
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/packages/mcp/src/cli/serve.ts#L27-L30
    observedAt: 2026-10-31
    observedBy: claude
  - source: config
    path: .env.example
    lines: 13-16
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/.env.example#L13-L16
    observedAt: 2026-10-31
    observedBy: claude

provenance:
  capturedBy: claude
---

# MCP server (dev)

`pnpm dev:mcp` serves the MCP endpoint at http://localhost:5190/mcp, bound to
127.0.0.1; `CASEBOOK_MCP_PORT`, `CASEBOOK_MCP_HOST` and `CASEBOOK_MCP_URL`
change port, bind address and public origin.
