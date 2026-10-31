---
id: datasource.case-files
type: datasource
title: "Case file storage"
attributes:
  zone: "private"

evidence:
  - source: code
    path: packages/store/src/files.ts
    lines: 73-75
    symbol: "filesDirectory"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/packages/store/src/files.ts#L73-L75
    observedAt: 2026-10-31
    observedBy: claude
  - source: infrastructure
    path: deploy/k8s/files.yaml
    lines: 1-11
    symbol: "PersistentVolumeClaim/casebook-files"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/deploy/k8s/files.yaml#L1-L11
    observedAt: 2026-10-31
    observedBy: claude
  - source: infrastructure
    path: Dockerfile
    lines: 43
    symbol: "CASEBOOK_FILES_DIR"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/Dockerfile#L43
    observedAt: 2026-10-31
    observedBy: claude

provenance:
  capturedBy: claude
---

# Case file storage

Files attached to cases (uploaded evidence) are stored on local disk in
`CASEBOOK_FILES_DIR`, or `.casebook/files` under the working directory. The
web app, the seed and the MCP server must share it. In the image it is
`/data/files`, backed on the k3d cluster by the `casebook-files` 1Gi
PersistentVolumeClaim mounted into web, mcp and the setup Job.
