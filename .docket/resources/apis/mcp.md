---
id: api.mcp
type: api
title: "casebook MCP tools"
attributes:
  protocol: "other"
  spec: "Model Context Protocol (Streamable HTTP)"

evidence:
  - source: code
    path: packages/mcp/src/tools.ts
    lines: 1-434
    symbol: "registerTool"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/packages/mcp/src/tools.ts#L1-L434
    observedAt: 2026-10-31
    observedBy: claude
  - source: docs
    path: README.md
    symbol: "Agents over MCP"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/README.md
    observedAt: 2026-10-31
    observedBy: claude

provenance:
  capturedBy: claude
---

# casebook MCP tools

The MCP tool surface agents use, mirroring the runner: `list_my_work`,
`list_processes`, `read_process`, `inspect_case`, `open_task`, `start_case`,
`complete_task` (values, files and decisions), `start_task`, `pause_task`,
`resume_task`, `skip_task` and `read_case_file`. Served over Streamable HTTP
at `/mcp`, protected as an OAuth 2.1 resource server (RFC 9728 metadata, RFC
8707 resource indicators). There is no approval tool.
