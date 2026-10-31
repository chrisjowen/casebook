---
id: service.web
type: service
title: "casebook web app"
attributes:
  language: "TypeScript"
  lifecycle: "active"

links:
  - rel: depends_on
    target: library.model
    evidence:
      - source: manifest
        path: apps/web/package.json
        lines: 13
        symbol: "dependencies.@casebook/model"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/apps/web/package.json#L13
        observedAt: 2026-10-31
        observedBy: claude

  - rel: depends_on
    target: library.store
    evidence:
      - source: manifest
        path: apps/web/package.json
        lines: 15
        symbol: "dependencies.@casebook/store"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/apps/web/package.json#L15
        observedAt: 2026-10-31
        observedBy: claude

  - rel: depends_on
    target: library.sheet-import
    evidence:
      - source: manifest
        path: apps/web/package.json
        lines: 14
        symbol: "dependencies.@casebook/sheet-import"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/apps/web/package.json#L14
        observedAt: 2026-10-31
        observedBy: claude

  - rel: uses
    target: agent.spreadsheet-wizard
    evidence:
      - source: manifest
        path: apps/web/package.json
        lines: 16
        symbol: "dependencies.@casebook/wizard-agent"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/apps/web/package.json#L16
        observedAt: 2026-10-31
        observedBy: claude

  - rel: depends_on
    target: datasource.postgres
    evidence:
      - source: infrastructure
        path: deploy/k8s/web.yaml
        lines: 30-41
        symbol: "envFrom.secretRef casebook-db"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/deploy/k8s/web.yaml#L30-L41
        observedAt: 2026-10-31
        observedBy: claude
        note: "The web container takes DATABASE_URL from the casebook-db Secret."

  - rel: depends_on
    target: datasource.case-files
    evidence:
      - source: code
        path: apps/web/src/lib/server/runner.ts
        lines: 34
        symbol: "runner"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/apps/web/src/lib/server/runner.ts#L34
        observedAt: 2026-10-31
        observedBy: claude
        note: "Uploaded evidence lives on local disk in CASEBOOK_FILES_DIR or .casebook/files."

  - rel: depends_on
    target: secret.casebook-db
    evidence:
      - source: infrastructure
        path: deploy/k8s/web.yaml
        lines: 36-38
        symbol: "envFrom.secretRef.name"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/deploy/k8s/web.yaml#L36-L38
        observedAt: 2026-10-31
        observedBy: claude

  - rel: runs_in
    target: pod.web
    evidence:
      - source: infrastructure
        path: deploy/k8s/web.yaml
        lines: 14-60
        symbol: "Deployment/web"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/deploy/k8s/web.yaml#L14-L60
        observedAt: 2026-10-31
        observedBy: claude

  - rel: deployed_to
    target: environment.local-dev
    evidence:
      - source: manifest
        path: package.json
        lines: 16
        symbol: "scripts.dev"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/package.json#L16
        observedAt: 2026-10-31
        observedBy: claude
        note: "pnpm dev runs moon run web:dev."

  - rel: deployed_to
    target: cluster.casebook-local
    evidence:
      - source: infrastructure
        path: deploy/k8s/web.yaml
        lines: 14-60
        symbol: "Deployment/web"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/deploy/k8s/web.yaml#L14-L60
        observedAt: 2026-10-31
        observedBy: claude

  - rel: exposes
    target: endpoint.local-k8s
    evidence:
      - source: infrastructure
        path: deploy/k8s/ingress.yaml
        lines: 41-47
        symbol: "rules.paths /"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/deploy/k8s/ingress.yaml#L41-L47
        observedAt: 2026-10-31
        observedBy: claude
        note: "Everything not under the MCP/OAuth paths goes to the web Service."

  - rel: documented_in
    target: architecture_record.adr-0022
    evidence:
      - source: docs
        path: README.md
        symbol: "Running cases"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/README.md
        observedAt: 2026-10-31
        observedBy: claude


evidence:
  - source: manifest
    path: apps/web/package.json
    lines: 1-39
    symbol: "@casebook/web"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/apps/web/package.json#L1-L39
    observedAt: 2026-10-31
    observedBy: claude
    note: "SvelteKit 2.70, Svelte 5.57, Tailwind 4, @xyflow/svelte and elkjs."
  - source: code
    path: apps/web/src/lib/server/session.ts
    lines: 14
    symbol: "devSignInEnabled"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/apps/web/src/lib/server/session.ts#L14
    observedAt: 2026-10-31
    observedBy: claude
    note: "Demo sign-in on under dev or CASEBOOK_DEMO_SIGNIN=on."
  - source: infrastructure
    path: deploy/k8s/web.yaml
    lines: 1-60
    symbol: "Service/web, Deployment/web"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/deploy/k8s/web.yaml#L1-L60
    observedAt: 2026-10-31
    observedBy: claude

provenance:
  capturedBy: claude
---

# casebook web app

The SvelteKit 2 app (Svelte 5, Tailwind 4, shadcn-svelte) in `apps/web`
(`@casebook/web`): both the case runner (My work, cases, tasks, case record)
and the process definition editor (the board, inspectors, lookups), plus the
spreadsheet wizard's UI. It reads and writes everything through
`@casebook/store` as the signed-in user, so every action passes `can()`.

Run locally with `pnpm dev` on http://localhost:5173. Built by the root
`Dockerfile` into the `casebook:local` image (`node apps/web/build`, port
3000) and deployed as the `web` Deployment on the local k3d cluster, where
the ingress serves it at http://localhost:8480.

Sign-in is a dev-only stand-in for OIDC: a passwordless pick of seeded users,
on under `pnpm dev` and in a production build only when
`CASEBOOK_DEMO_SIGNIN=on` (see [[constraint.demo-sign-in-is-dev-only]]).
