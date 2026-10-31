---
id: architecture_record.adr-0023
type: architecture_record
title: "ADR 0023: Agents work cases over MCP, signed in as a user"

tags:
  - adr

attributes:
  number: 23
  path: docs/decisions/0023-agents-over-mcp.md
  status: accepted

links:
  - rel: stored_in
    target: repository.casebook
    evidence:
      - source: docs
        path: docs/decisions/README.md
        observedAt: 2026-10-31
        observedBy: claude
        note: Listed in casebook's decision log as Accepted.

evidence:
  - source: docs
    path: docs/decisions/0023-agents-over-mcp.md
    lines: 1-30
    symbol: "0023. Agents work cases over MCP, signed in as a user"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/docs/decisions/0023-agents-over-mcp.md
    observedAt: 2026-10-31
    observedBy: claude
    note: "ADR file with status line 'Accepted. Builds on 0009, 0017, 0020 and 0022.'."

provenance:
  capturedBy: claude
---

# ADR 0023: Agents work cases over MCP, signed in as a user

Casebook's architecture decision record 0023, "Agents work cases over MCP, signed in as a user", kept in
`docs/decisions/0023-agents-over-mcp.md` and listed in the decision log `docs/decisions/README.md`.
Status: Accepted. Builds on 0009, 0017, 0020 and 0022.

What it decides, condensed from its Decision section: A new package, `@casebook/mcp`, is an MCP server built on the official TypeScript SDK (v2), served over Streamable HTTP as a separate dev process (`pnpm dev:mcp`, `http://localhost:5190/mcp`). Its tools mirror the runner: list my work (casebooks, a casebook's queues, guest requests), list and read processes (read-only), inspect a case, open a task, start a case, complete a task or record a decision with its values and files, start, pause, resume and skip a task, and read a case file. Each call goes through the store's runtime functions, so `can` decides it and the store's guest scoping applies. There is no approval tool. Completing an approval as an agent is refused as `human-only`, and so …

Its status line relates it to earlier records: [[architecture_record.adr-0009]], [[architecture_record.adr-0017]], [[architecture_record.adr-0020]], [[architecture_record.adr-0022]] ("Accepted. Builds on 0009, 0017, 0020 and 0022.").

Captured from the ADR file during docket's initial scan; the ADR itself is
the authority for context and consequences.
