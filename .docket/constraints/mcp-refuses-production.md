---
id: constraint.mcp-refuses-production
type: constraint
title: "The MCP server refuses to run with NODE_ENV=production"

links:
  - rel: governs
    target: repository.casebook
    evidence:
      - source: code
        path: packages/mcp/src/cli/serve.ts
        lines: 15-20
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/packages/mcp/src/cli/serve.ts#L15-L20
        observedAt: 2026-10-31
        observedBy: claude


evidence:
  - source: code
    path: packages/mcp/src/cli/serve.ts
    lines: 15-20
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/packages/mcp/src/cli/serve.ts#L15-L20
    observedAt: 2026-10-31
    observedBy: claude

provenance:
  capturedBy: claude
---

# The MCP server refuses to run with NODE_ENV=production

The MCP server's dev authorization server signs anyone in as any demo user, so `serve.ts` exits under `NODE_ENV=production`; a real authorization server is needed before any shared deployment.
