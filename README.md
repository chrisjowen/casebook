# casebook

Define, visualize and (later) run human-in-the-loop processes as cases.

casebook is a generic process modeler and runner for business and human-in-the-loop processes, not necessarily automated.
Processes are stored as versioned definitions of stages, steps, facts, roles and approvals.
A case is the shared subject several processes attach to, sharing one fact store.
People and agents act on cases as principals within hierarchical namespaces.
v1 focuses on defining processes, viewing them as a graph, and an agent-assisted wizard that imports spreadsheets.

## Docs

- [Decision log](docs/decisions/README.md)
- [Roadmap](docs/roadmap.md)
- [Glossary](docs/glossary.md)

## Repository layout

A [moon](https://moonrepo.dev) workspace with pnpm workspaces underneath, all TypeScript.

| Path                    | What it is                                                                             |
| ----------------------- | -------------------------------------------------------------------------------------- |
| `apps/web`              | SvelteKit 2 app (Svelte 5, Tailwind 4, shadcn-svelte).                                 |
| `packages/model`        | Process-definition types, JSON Schema, validation and publish checks. Pure TypeScript. |
| `packages/store`        | Postgres persistence with Drizzle ORM; migrations via drizzle-kit.                     |
| `packages/sheet-import` | Reads .xlsx workbooks into neutral rows and cells for the wizard.                      |
| `packages/wizard-agent` | Placeholder for the deepagents-based authoring agent.                                  |

## Prerequisites

- [proto](https://moonrepo.dev/proto) 0.60 or later. It installs the pinned moon, Node and pnpm versions from `.prototools`.
- Docker, for the local Postgres.

## Getting started

```sh
proto install            # moon, Node 22 and pnpm at the pinned versions
pnpm install
cp .env.example .env
pnpm db:up               # Postgres 17 on 127.0.0.1:5433
pnpm dev                 # web app on http://localhost:5173
```

If port 5433 is taken, set `CASEBOOK_PG_PORT` in `.env` and update the port in `DATABASE_URL` to match.
Stop Postgres with `pnpm db:down`; its data stays in the `casebook-pgdata` volume.

## Checks

Each command runs the matching moon task across every project.

```sh
pnpm check               # type-check
pnpm lint                # ESLint
pnpm test                # Vitest
pnpm build               # build all projects
pnpm format              # Prettier (pnpm format:check to verify only)
```

Run a single project's task with moon directly, for example `moon run model:test`.
The `store` tests need Postgres (`pnpm db:up` and a `.env`): they migrate a throwaway database next to the one `DATABASE_URL` names, and are skipped when it is unset outside CI.

## Database migrations

Drizzle is configured in `packages/store/drizzle.config.ts` and reads `DATABASE_URL` from the root `.env`.

```sh
pnpm --filter @casebook/store db:generate   # generate SQL from src/schema.ts
pnpm --filter @casebook/store db:migrate    # apply migrations
```
