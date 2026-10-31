---
id: decision.local-kubernetes
type: decision
title: "A local Kubernetes deployment, with the demo sign-in on"

links:
  - rel: documented_in
    target: architecture_record.adr-0027
    evidence:
      - source: docs
        path: docs/decisions/README.md
        symbol: "0027"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/docs/decisions/README.md
        observedAt: 2026-10-31
        observedBy: claude


evidence:
  - source: docs
    path: docs/decisions/0027-local-kubernetes.md
    symbol: "Decision"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/docs/decisions/0027-local-kubernetes.md
    observedAt: 2026-10-31
    observedBy: claude

provenance:
  capturedBy: claude
---

# A local Kubernetes deployment, with the demo sign-in on

casebook runs as a production build on a local k3d cluster via `pnpm deploy:local`, with the passwordless demo sign-in turned on by `CASEBOOK_DEMO_SIGNIN=on`.
