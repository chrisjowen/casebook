# 0012. Technology stack

Status: Accepted

## Context
We want one language across the stack and a fast path to a graph UI and an authoring agent.

## Decision
- Moon-managed monorepo with pnpm, all TypeScript.
- SvelteKit with shadcn-svelte.
- Svelte Flow with ELK layout for the graph; D3 only for a later bespoke view.
- Drizzle with Postgres.
- The wizard agent uses the `deepagents` npm package (TypeScript port of LangChain Deep Agents) on Claude.

A Python service is a possible later split for heavy document extraction, at the same operation-layer boundary.

## Consequences
- Shared types between UI, server and agent.
- Heavy extraction can move out without changing the operation API.
