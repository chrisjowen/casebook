---
id: pipeline.local-deploy
type: pipeline
title: "Wheelhouse Deployed locally stage"
attributes:
  path: ".wheelhouse.yaml"
  provider: "wheelhouse"
  triggers:
    - "merged"

links:
  - rel: defined_in
    target: repository.casebook
    evidence:
      - source: config
        path: .wheelhouse.yaml
        lines: 1-31
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/.wheelhouse.yaml#L1-L31
        observedAt: 2026-10-31
        observedBy: claude

  - rel: produces
    target: artifact.casebook-image
    evidence:
      - source: code
        path: deploy/local/up.sh
        lines: 36
        symbol: "docker build"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/deploy/local/up.sh#L36
        observedAt: 2026-10-31
        observedBy: claude

  - rel: uses
    target: system.wheelhouse
    evidence:
      - source: config
        path: .wheelhouse.yaml
        lines: 12-13
        symbol: "extends: ship"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/.wheelhouse.yaml#L12-L13
        observedAt: 2026-10-31
        observedBy: claude


evidence:
  - source: config
    path: .wheelhouse.yaml
    lines: 1-31
    symbol: "checks.local-deploy"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/.wheelhouse.yaml#L1-L31
    observedAt: 2026-10-31
    observedBy: claude

provenance:
  capturedBy: claude
---

# Wheelhouse Deployed locally stage

`.wheelhouse.yaml` extends Wheelhouse's `ship` passage with a `local-deploy`
command check: after a merge, Wheelhouse runs `pnpm deploy:local` on the tip
of main in a fresh checkout (20-minute limit, retried hourly, gives up after a
day), so `casebook-local` always runs latest main. Only `CASEBOOK_LOCAL_PORT`
is passed through. Command checks stay off until the captain allows them on
casebook's passage page.
