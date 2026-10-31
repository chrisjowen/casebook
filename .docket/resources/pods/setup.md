---
id: pod.setup
type: pod
title: "setup job (local k8s)"
attributes:
  kind: "job"
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

  - rel: runs_image
    target: artifact.casebook-image
    evidence:
      - source: infrastructure
        path: deploy/k8s/setup-job.yaml
        symbol: "image: casebook:local"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/deploy/k8s/setup-job.yaml
        observedAt: 2026-10-31
        observedBy: claude


evidence:
  - source: infrastructure
    path: deploy/k8s/setup-job.yaml
    lines: 1-39
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/deploy/k8s/setup-job.yaml#L1-L39
    observedAt: 2026-10-31
    observedBy: claude

provenance:
  capturedBy: claude
---

# setup job (local k8s)

Waits for Postgres, then migrates the database and loads the demo data once, like `pnpm db:seed`; the deploy script deletes and re-creates it on every run.
