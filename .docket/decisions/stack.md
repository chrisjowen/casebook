---
id: decision.stack
type: decision
title: "Moon/pnpm TypeScript monorepo on SvelteKit, Drizzle/Postgres and deepagents"

links:
  - rel: documented_in
    target: architecture_record.adr-0012
    evidence:
      - source: docs
        path: docs/decisions/README.md
        symbol: "0012"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/docs/decisions/README.md
        observedAt: 2026-10-31
        observedBy: claude


evidence:
  - source: docs
    path: docs/decisions/0012-stack.md
    symbol: "Decision"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/docs/decisions/0012-stack.md
    observedAt: 2026-10-31
    observedBy: claude

provenance:
  capturedBy: claude
---

# Moon/pnpm TypeScript monorepo on SvelteKit, Drizzle/Postgres and deepagents

One language across the stack: a moon-managed pnpm monorepo, SvelteKit with shadcn-svelte, Svelte Flow with ELK for the graph, Drizzle on Postgres, and the `deepagents` npm package for the wizard agent. A Python service is a possible later split for heavy document extraction.
