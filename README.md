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

| Path                    | What it is                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| `apps/web`              | SvelteKit 2 app (Svelte 5, Tailwind 4, shadcn-svelte): the process definition editor.                   |
| `packages/model`        | Process-definition types, JSON Schema, validation, publish checks and node operations. Pure TypeScript. |
| `packages/store`        | Postgres persistence, permission checks, definition editing and the demo seed; Drizzle ORM migrations.  |
| `packages/sheet-import` | Reads .xlsx workbooks into neutral rows and cells for the wizard.                                       |
| `packages/wizard-agent` | Placeholder for the deepagents-based authoring agent.                                                   |

## Prerequisites

- [proto](https://moonrepo.dev/proto) 0.60 or later. It installs the pinned moon, Node and pnpm versions from `.prototools`.
- Docker, for the local Postgres.

## Getting started

```sh
proto install            # moon, Node 22 and pnpm at the pinned versions
pnpm install
cp .env.example .env
pnpm db:up               # Postgres 17 on 127.0.0.1:5433
pnpm db:seed             # migrate, then load the demo account, users and processes
pnpm dev                 # web app on http://localhost:5173
```

If port 5433 is taken, set `CASEBOOK_PG_PORT` in `.env` and update the port in `DATABASE_URL` to match.
Stop Postgres with `pnpm db:down`; its data stays in the `casebook-pgdata` volume.
`pnpm db:seed` does nothing once the demo account exists; to start again, run `docker compose down -v`, then `pnpm db:up` and `pnpm db:seed`.

## Definition editor

`pnpm dev` serves the editor.
A process is built on the **board** (ADR 0021): its stages are columns, laid out from the definition, with step and decision cards in them.
Role lanes and a fact flow (Svelte Flow with an ELK layout) are read-only lenses on it, alongside a per-workspace process map of shared fact types.
Inspectors cover steps, decisions, stages, fact types and processes, including the publish checks from `packages/model`.

On the board, everything is added and linked in place:

- a stage's "+" or "Add step", a card's "+", right-click, `N` and `D`, or the palette (`/`) add a named step or decision;
- "Add stage" after the last column adds a stage, and a stage's menu moves it left or right;
- dragging a card's dot onto another step links them: the later step now needs what the earlier one records.
  Dragging a fact's dot or a decision's choice works the same way, and dropping in empty space adds a new step there;
- dragging a card onto another column moves it to that stage, and double-clicking a name renames it;
- a step's **Records** and **Needs first** add, rename, re-kind and remove its facts in place.

Definitions are read from and saved to Postgres through `packages/store` (`apps/web/src/lib/server/definitions.ts` and the form actions in `apps/web/src/routes/+page.server.ts`).
Each workspace is a namespace the signed-in user can read.
Every gesture changes the draft through the model's node operations and is saved as one draft revision, with a notice that offers Undo (`⌘Z` too).
The process details list what the draft changes since the latest published version, with Publish and Undo.
A governed process publishes when someone presses Publish and the publish checks pass; a living process publishes every edit straight away.
"New process" (the + after the process tabs) starts a process in the workspace.

Sign-in is a dev-only stand-in for OIDC: pick one of the seeded users at `/signin`, with no password.
It is on only in `pnpm dev`, never in a production build.
Every read and write acts as that user and goes through `can()`, and actions they cannot take are disabled with the reason.
The seed (`packages/store/src/seed.ts`) creates account `acme` with these users, and loads the model's synthetic fixtures as published definitions:

| User            | Access                                                      | Can                                                        |
| --------------- | ----------------------------------------------------------- | ---------------------------------------------------------- |
| Olive Owner     | account-owner of `acme`                                     | everything                                                 |
| Devon Developer | developer of `acme`, namespace-admin of `acme/eng/platform` | read everything; create and publish in `acme/eng/platform` |
| Wren Writer     | read-only of `acme`, write on `acme/eng`                    | read everything; edit, create and publish under `acme/eng` |
| Rae Reader      | read-only of `acme`                                         | read only                                                  |

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
The `store` tests, which cover the seed, editing, publishing and permission refusals, need Postgres (`pnpm db:up` and a `.env`): they migrate a throwaway database next to the one `DATABASE_URL` names, and are skipped when it is unset outside CI.

## Database migrations

Drizzle is configured in `packages/store/drizzle.config.ts` and reads `DATABASE_URL` from the root `.env`.

```sh
pnpm --filter @casebook/store db:generate   # generate SQL from src/schema.ts
pnpm --filter @casebook/store db:migrate    # apply migrations
```
