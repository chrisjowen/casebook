---
id: constraint.demo-sign-in-is-dev-only
type: constraint
title: "The passwordless demo sign-in is dev-only"

links:
  - rel: governs
    target: repository.casebook
    evidence:
      - source: code
        path: apps/web/src/lib/server/session.ts
        lines: 1-14
        symbol: "devSignInEnabled"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/apps/web/src/lib/server/session.ts#L1-L14
        observedAt: 2026-10-31
        observedBy: claude


evidence:
  - source: code
    path: apps/web/src/lib/server/session.ts
    lines: 1-14
    symbol: "devSignInEnabled"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/apps/web/src/lib/server/session.ts#L1-L14
    observedAt: 2026-10-31
    observedBy: claude
  - source: infrastructure
    path: deploy/k8s/config.yaml
    lines: 21-22
    symbol: "CASEBOOK_DEMO_SIGNIN"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/deploy/k8s/config.yaml#L21-L22
    observedAt: 2026-10-31
    observedBy: claude

provenance:
  capturedBy: claude
---

# The passwordless demo sign-in is dev-only

The web sign-in is a dev-only stand-in for OIDC: on under `pnpm dev`, and in a production build only when `CASEBOOK_DEMO_SIGNIN=on` (as only the local k8s deploy sets). There is no identity provider yet.
