---
id: constraint.local-k8s-is-throwaway
type: constraint
title: "deploy/k8s is for a throwaway local cluster only"

links:
  - rel: governs
    target: repository.casebook
    evidence:
      - source: infrastructure
        path: deploy/k8s/kustomization.yaml
        lines: 1-3
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/deploy/k8s/kustomization.yaml#L1-L3
        observedAt: 2026-10-31
        observedBy: claude


evidence:
  - source: infrastructure
    path: deploy/k8s/kustomization.yaml
    lines: 1-3
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/deploy/k8s/kustomization.yaml#L1-L3
    observedAt: 2026-10-31
    observedBy: claude
  - source: docs
    path: README.md
    symbol: "Local Kubernetes"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/README.md
    observedAt: 2026-10-31
    observedBy: claude

provenance:
  capturedBy: claude
---

# deploy/k8s is for a throwaway local cluster only

Everything in `deploy/k8s` is for a throwaway cluster on this machine: the database password is not a secret and the web app runs with the passwordless demo sign-in on. These manifests must not be used for a shared deployment as-is.
