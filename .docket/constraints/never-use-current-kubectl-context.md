---
id: constraint.never-use-current-kubectl-context
type: constraint
title: "Local deploy never uses the current kubectl context"

links:
  - rel: governs
    target: repository.casebook
    evidence:
      - source: code
        path: deploy/local/common.sh
        lines: 1-45
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/deploy/local/common.sh#L1-L45
        observedAt: 2026-10-31
        observedBy: claude


evidence:
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

# Local deploy never uses the current kubectl context

The local deploy scripts keep casebook-local's kubeconfig in its own file, pin every kubectl call to `k3d-casebook-local`, and refuse to run if that file names another context or a server off this machine.
