---
id: endpoint.local-k8s
type: endpoint
title: "casebook on the local cluster"
attributes:
  url: "http://localhost:8480"
  visibility: "private"

evidence:
  - source: infrastructure
    path: deploy/k8s/ingress.yaml
    lines: 1-47
    symbol: "Ingress/casebook"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/deploy/k8s/ingress.yaml#L1-L47
    observedAt: 2026-10-31
    observedBy: claude
  - source: code
    path: deploy/local/up.sh
    lines: 12
    symbol: "CASEBOOK_LOCAL_PORT"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/deploy/local/up.sh#L12
    observedAt: 2026-10-31
    observedBy: claude

provenance:
  capturedBy: claude
---

# casebook on the local cluster

The k3d cluster's Traefik ingress serves casebook at http://localhost:8480
(`CASEBOOK_LOCAL_PORT` at cluster creation): `/mcp`, `/oauth` and the OAuth
well-known paths go to the mcp Service, everything else to web.
