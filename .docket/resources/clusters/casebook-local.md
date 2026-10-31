---
id: cluster.casebook-local
type: cluster
title: "k3d cluster casebook-local"
attributes:
  platform: "kubernetes"
  provider: "k3d"

evidence:
  - source: code
    path: deploy/local/up.sh
    lines: 12-36
    symbol: "k3d cluster create"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/deploy/local/up.sh#L12-L36
    observedAt: 2026-10-31
    observedBy: claude
  - source: code
    path: deploy/local/common.sh
    lines: 1-45
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/deploy/local/common.sh#L1-L45
    observedAt: 2026-10-31
    observedBy: claude

provenance:
  capturedBy: claude
---

# k3d cluster casebook-local

A single-server k3d cluster named `casebook-local` created by
`deploy/local/up.sh` if missing, with the image loaded by `k3d image import`.
Its kubeconfig lives in its own file
(`~/.config/k3d/kubeconfig-casebook-local.yaml`) and every kubectl call is
pinned to the `k3d-casebook-local` context (see
[[constraint.never-use-current-kubectl-context]]). Workloads live in the
`casebook` namespace.
