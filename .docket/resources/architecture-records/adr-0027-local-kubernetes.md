---
id: architecture_record.adr-0027
type: architecture_record
title: "ADR 0027: A local Kubernetes deployment, with the demo sign-in on"

tags:
  - adr

attributes:
  number: 27
  path: docs/decisions/0027-local-kubernetes.md
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
    path: docs/decisions/0027-local-kubernetes.md
    lines: 1-22
    symbol: "0027. A local Kubernetes deployment, with the demo sign-in on"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/docs/decisions/0027-local-kubernetes.md
    observedAt: 2026-10-31
    observedBy: claude
    note: "ADR file with status line 'Accepted. Amends 0020.'."

provenance:
  capturedBy: claude
---

# ADR 0027: A local Kubernetes deployment, with the demo sign-in on

Casebook's architecture decision record 0027, "A local Kubernetes deployment, with the demo sign-in on", kept in
`docs/decisions/0027-local-kubernetes.md` and listed in the decision log `docs/decisions/README.md`.
Status: Accepted. Amends 0020.

What it decides, condensed from its Decision section: One image (`Dockerfile`) builds the workspace and carries the web app's Node build, the MCP server and the store's migrate-and-seed command; each runs with its own `node` command. `pnpm deploy:local` runs casebook on a k3d cluster named `casebook-local` on this machine, creating it when missing: Postgres as a StatefulSet, a setup Job that migrates and seeds like `pnpm db:seed`, the web app and the MCP server as Deployments sharing one volume for case files, and one Ingress on `http://localhost:8480` that sends `/mcp`, `/oauth` and the OAuth discovery paths to the MCP server and everything else to the web app. The manifests are plain Kustomize under `deploy/k8s`, with dev-only values. `pnpm …

Its status line relates it to earlier records: [[architecture_record.adr-0020]] ("Accepted. Amends 0020.").

Captured from the ADR file during docket's initial scan; the ADR itself is
the authority for context and consequences.
