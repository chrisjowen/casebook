---
id: pod.mcp
type: pod
title: "mcp deployment (local k8s)"
attributes:
  kind: "deployment"
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
        path: deploy/k8s/mcp.yaml
        symbol: "image: casebook:local"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/deploy/k8s/mcp.yaml
        observedAt: 2026-10-31
        observedBy: claude


evidence:
  - source: infrastructure
    path: deploy/k8s/mcp.yaml
    lines: 16-61
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/deploy/k8s/mcp.yaml#L16-L61
    observedAt: 2026-10-31
    observedBy: claude

provenance:
  capturedBy: claude
---

# mcp deployment (local k8s)

The MCP server: `node packages/mcp/dist/cli/serve.js` on port 5190 from `casebook:local`, with `NODE_ENV=development` so its dev sign-in starts.
