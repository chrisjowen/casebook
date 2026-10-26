# 0027. A local Kubernetes deployment, with the demo sign-in on

Status: Accepted. Amends 0020.

## Context
casebook ran only as `pnpm dev` processes against a Postgres in Docker Compose.
There was no image and nothing showed it running as a production build, the way a shared deployment would run it.
The dev sign-in (0020) is on only in development builds, so a production build could not be signed into at all.

## Decision
- **One image** (`Dockerfile`) builds the workspace and carries the web app's Node build, the MCP server and the store's migrate-and-seed command; each runs with its own `node` command.
- **`pnpm deploy:local`** runs casebook on a k3d cluster named `casebook-local` on this machine, creating it when missing: Postgres as a StatefulSet, a setup Job that migrates and seeds like `pnpm db:seed`, the web app and the MCP server as Deployments sharing one volume for case files, and one Ingress on `http://localhost:8480` that sends `/mcp`, `/oauth` and the OAuth discovery paths to the MCP server and everything else to the web app. The manifests are plain Kustomize under `deploy/k8s`, with dev-only values.
- **`pnpm deploy:local:down`** deletes that cluster and nothing else.
- The scripts never use the current kubectl context: kubectl reads only the cluster's own kubeconfig file, is pinned to `k3d-casebook-local` on every call, and refuses to run when that file names another context or a server off this machine. Creating the cluster leaves the default kubeconfig alone.
- **A production build turns the demo sign-in on only when `CASEBOOK_DEMO_SIGNIN=on`**, which the local deployment sets. Without it, a production build still has no sign-in, as before.

## Consequences
- The deployed web app is a production build, so it checks form posts against `ORIGIN`, which the deploy script sets to the cluster's address.
- The MCP server keeps its dev sign-in and runs with `NODE_ENV=development` in the cluster.
- The database and case files live in the cluster: redeploying keeps them, and deleting the cluster drops them.
- Setting `CASEBOOK_DEMO_SIGNIN=on` anywhere shared would let anyone act as any demo user; OIDC (0020) is still needed before such a deployment.
