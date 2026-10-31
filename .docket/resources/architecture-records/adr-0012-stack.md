---
id: architecture_record.adr-0012
type: architecture_record
title: "ADR 0012: Technology stack"

tags:
  - adr

attributes:
  number: 12
  path: docs/decisions/0012-stack.md
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
    path: docs/decisions/0012-stack.md
    lines: 1-20
    symbol: "0012. Technology stack"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/docs/decisions/0012-stack.md
    observedAt: 2026-10-31
    observedBy: claude
    note: "ADR file with status line 'Accepted'."

provenance:
  capturedBy: claude
---

# ADR 0012: Technology stack

Casebook's architecture decision record 0012, "Technology stack", kept in
`docs/decisions/0012-stack.md` and listed in the decision log `docs/decisions/README.md`.
Status: Accepted

What it decides, condensed from its Decision section: Moon-managed monorepo with pnpm, all TypeScript. SvelteKit with shadcn-svelte. Svelte Flow with ELK layout for the graph; D3 only for a later bespoke view. Drizzle with Postgres. The wizard agent uses the `deepagents` npm package (TypeScript port of LangChain Deep Agents) on Claude. A Python service is a possible later split for heavy document extraction, at the same operation-layer boundary.

Captured from the ADR file during docket's initial scan; the ADR itself is
the authority for context and consequences.
