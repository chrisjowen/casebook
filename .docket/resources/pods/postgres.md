---
id: pod.postgres
type: pod
title: "postgres statefulset (local k8s)"
attributes:
  kind: "statefulset"
  namespace: "casebook"

links:
  - rel: deployed_to
    target: cluster.casebook-local
    evidence:
      - source: infrastructure
        path: deploy/k8s/kustomization.yaml
        lines: 6
        symbol: "namespace"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/deploy/k8s/kustomization.yaml#L6
        observedAt: 2026-10-31
        observedBy: claude


evidence:
  - source: infrastructure
    path: deploy/k8s/postgres.yaml
    lines: 14-60
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/deploy/k8s/postgres.yaml#L14-L60
    observedAt: 2026-10-31
    observedBy: claude

provenance:
  capturedBy: claude
---

# postgres statefulset (local k8s)

Postgres 17 with a 1Gi data volume, credentials from `casebook-db`.
