# 0020. Editing definitions through the store, with a dev sign-in

Status: Accepted. Amends 0019.

## Context
The editor (0013) moves from synthetic fixtures to definitions stored in Postgres (0002), edited with node operations (0019) under change policies (0016, 0018) and permission checks (0017).
0019 expected a `RevisionStore` adapter in `@casebook/store`, but the model's draft functions append a revision and then publish it in separate calls, while the store records a living edit and its version in one transaction.
There is no identity provider yet, and agents will act through MCP as the user they sign in as over OAuth (0009), so every check is about what a user may do.

## Decision
- `@casebook/store` gets a definition service (`src/definitions.ts`) that composes the model's pure functions (`commit`, `undo`, `startHistory`, `publish`, `diff`, `checkPublish`) with the repository writes, instead of a `RevisionStore` adapter.
  Draft revisions also store their operations and the revision they revert to.
- Every read and write takes an `Actor` and checks it with `can`: namespaces the actor cannot read are hidden, and refused writes return a plain-language reason.
- An edit names the draft revision it was made against; a newer head refuses it as stale instead of overwriting.
- The web app's sign-in is a dev-only stand-in: choose one of the seeded demo users, with no password.
  It is on in development, and in a production build only when `CASEBOOK_DEV_SIGNIN=true` is set.
- The model's fixtures are seed data only (0014): `pnpm db:seed` loads them as published definitions with demo users holding different roles.

## Consequences
- The editor and future MCP tools share one write path, so an agent signed in as a user can do exactly what that user can.
- The dev sign-in must be replaced by OIDC before casebook is deployed anywhere shared.
- A governed definition that requires approval cannot be published until the approval flow exists.
