---
id: service.mcp
type: service
title: "casebook MCP server"
attributes:
  language: "TypeScript"
  lifecycle: "active"

links:
  - rel: depends_on
    target: library.store
    evidence:
      - source: manifest
        path: packages/mcp/package.json
        lines: 18
        symbol: "dependencies.@casebook/store"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/packages/mcp/package.json#L18
        observedAt: 2026-10-31
        observedBy: claude

  - rel: depends_on
    target: library.model
    evidence:
      - source: manifest
        path: packages/mcp/package.json
        lines: 17
        symbol: "dependencies.@casebook/model"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/packages/mcp/package.json#L17
        observedAt: 2026-10-31
        observedBy: claude

  - rel: depends_on
    target: datasource.postgres
    evidence:
      - source: code
        path: packages/mcp/src/cli/serve.ts
        lines: 21-25
        symbol: "DATABASE_URL"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/packages/mcp/src/cli/serve.ts#L21-L25
        observedAt: 2026-10-31
        observedBy: claude
        note: "Refuses to start without DATABASE_URL."

  - rel: depends_on
    target: datasource.case-files
    evidence:
      - source: code
        path: packages/mcp/src/cli/serve.ts
        lines: 32-36
        symbol: "filesDirectory"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/packages/mcp/src/cli/serve.ts#L32-L36
        observedAt: 2026-10-31
        observedBy: claude
        note: "Serves case files from the shared files directory."

  - rel: depends_on
    target: secret.casebook-db
    evidence:
      - source: infrastructure
        path: deploy/k8s/mcp.yaml
        lines: 35-41
        symbol: "envFrom.secretRef casebook-db"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/deploy/k8s/mcp.yaml#L35-L41
        observedAt: 2026-10-31
        observedBy: claude

  - rel: exposes
    target: api.mcp
    evidence:
      - source: code
        path: packages/mcp/src/tools.ts
        lines: 97-434
        symbol: "registerTool"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/packages/mcp/src/tools.ts#L97-L434
        observedAt: 2026-10-31
        observedBy: claude
        note: "Registers the casebook tools on the MCP server."

  - rel: exposes
    target: endpoint.mcp-dev
    evidence:
      - source: code
        path: packages/mcp/src/cli/serve.ts
        lines: 27-30
        symbol: "CASEBOOK_MCP_PORT"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/packages/mcp/src/cli/serve.ts#L27-L30
        observedAt: 2026-10-31
        observedBy: claude
        note: "Port 5190 on 127.0.0.1 by default, resource path /mcp."

  - rel: runs_in
    target: pod.mcp
    evidence:
      - source: infrastructure
        path: deploy/k8s/mcp.yaml
        lines: 16-61
        symbol: "Deployment/mcp"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/deploy/k8s/mcp.yaml#L16-L61
        observedAt: 2026-10-31
        observedBy: claude

  - rel: deployed_to
    target: cluster.casebook-local
    evidence:
      - source: infrastructure
        path: deploy/k8s/mcp.yaml
        lines: 16-61
        symbol: "Deployment/mcp"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/deploy/k8s/mcp.yaml#L16-L61
        observedAt: 2026-10-31
        observedBy: claude

  - rel: documented_in
    target: architecture_record.adr-0023
    evidence:
      - source: docs
        path: docs/decisions/0023-agents-over-mcp.md
        lines: 11-25
        symbol: "Decision"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/docs/decisions/0023-agents-over-mcp.md#L11-L25
        observedAt: 2026-10-31
        observedBy: claude


evidence:
  - source: manifest
    path: packages/mcp/package.json
    lines: 1-31
    symbol: "@casebook/mcp"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/packages/mcp/package.json#L1-L31
    observedAt: 2026-10-31
    observedBy: claude
    note: "Depends on @modelcontextprotocol/server and /node, drizzle-orm and zod."
  - source: code
    path: packages/mcp/src/cli/serve.ts
    lines: 15-20
    symbol: "NODE_ENV check"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/packages/mcp/src/cli/serve.ts#L15-L20
    observedAt: 2026-10-31
    observedBy: claude
    note: "Exits with an error when NODE_ENV is production."
  - source: infrastructure
    path: deploy/k8s/mcp.yaml
    lines: 1-61
    symbol: "Service/mcp, Deployment/mcp"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/deploy/k8s/mcp.yaml#L1-L61
    observedAt: 2026-10-31
    observedBy: claude
    note: "Runs node packages/mcp/dist/cli/serve.js on port 5190 with NODE_ENV=development."

provenance:
  capturedBy: claude
---

# casebook MCP server

`@casebook/mcp` in `packages/mcp`: an MCP server (official TypeScript SDK v2,
`@modelcontextprotocol/server`) that lets agents work cases as the person
they sign in as, over Streamable HTTP with OAuth 2.1 (ADR 0023). Every tool
call goes through the store's runtime, so `can()` decides it and guest
scoping applies; approvals and human-only steps are refused to agents.

Run with `pnpm dev:mcp` on http://localhost:5190/mcp. Its authorization server
is a dev one in the same process (passwordless pick of a seeded user, 15-minute
access tokens refreshed for up to 8 hours, held in memory), and `serve.ts`
exits when `NODE_ENV=production`; the k8s Deployment therefore sets
`NODE_ENV=development` for it. On the local cluster it is served under
`/mcp`, `/oauth` and the OAuth well-known paths of http://localhost:8480.
