---
id: secret.casebook-db
type: secret
title: "casebook-db Kubernetes Secret"
attributes:
  store: "Kubernetes Secret (deploy/k8s/config.yaml)"

links:
  - rel: stored_in
    target: repository.casebook
    evidence:
      - source: infrastructure
        path: deploy/k8s/config.yaml
        lines: 1-12
        symbol: "Secret/casebook-db"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/deploy/k8s/config.yaml#L1-L12
        observedAt: 2026-10-31
        observedBy: claude


evidence:
  - source: infrastructure
    path: deploy/k8s/config.yaml
    lines: 1-12
    symbol: "Secret/casebook-db"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/deploy/k8s/config.yaml#L1-L12
    observedAt: 2026-10-31
    observedBy: claude

provenance:
  capturedBy: claude
---

# casebook-db Kubernetes Secret

The `casebook-db` Secret on the local k3d cluster holds the Postgres user,
password, database and `DATABASE_URL` for the postgres StatefulSet, web, mcp
and setup Job. It is declared in `deploy/k8s/config.yaml` with dev-only values
for a throwaway cluster; the repository says these are not real secrets (see
[[constraint.local-k8s-is-throwaway]]). Values are not recorded here.
