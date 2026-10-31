---
id: artifact.casebook-image
type: artifact
title: "casebook container image"
attributes:
  kind: "container_image"
  name: "casebook:local"

links:
  - rel: built_from
    target: repository.casebook
    evidence:
      - source: infrastructure
        path: Dockerfile
        lines: 1-61
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/Dockerfile#L1-L61
        observedAt: 2026-10-31
        observedBy: claude


evidence:
  - source: infrastructure
    path: Dockerfile
    lines: 1-61
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/Dockerfile#L1-L61
    observedAt: 2026-10-31
    observedBy: claude
  - source: code
    path: deploy/local/up.sh
    lines: 31-36
    symbol: "docker build"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/deploy/local/up.sh#L31-L36
    observedAt: 2026-10-31
    observedBy: claude

provenance:
  capturedBy: claude
---

# casebook container image

One image for the web app, the MCP server and the database setup job, built
from the root `Dockerfile` (Node 22.22.0 bookworm-slim, multi-stage, runs as
`node`, exposes 3000 and 5190). Tagged `casebook:local` and imported straight
into the k3d cluster; it is not pushed to a registry.
