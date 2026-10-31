---
id: environment.local-k8s
type: environment
title: "Local Kubernetes (casebook-local)"
attributes:
  environmentType: "local"

evidence:
  - source: infrastructure
    path: deploy/k8s/kustomization.yaml
    lines: 1-19
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/deploy/k8s/kustomization.yaml#L1-L19
    observedAt: 2026-10-31
    observedBy: claude
  - source: docs
    path: docs/decisions/0027-local-kubernetes.md
    lines: 1-10
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/docs/decisions/0027-local-kubernetes.md#L1-L10
    observedAt: 2026-10-31
    observedBy: claude

provenance:
  capturedBy: claude
---

# Local Kubernetes (casebook-local)

A production build of casebook on the local k3d cluster `casebook-local`
(ADR 0027), deployed with `pnpm deploy:local` and torn down with
`pnpm deploy:local:down`. Needs Docker, k3d and kubectl and nothing from
`.env`. Runs with the passwordless demo sign-in on. Wheelhouse redeploys it
after each merge to main.
