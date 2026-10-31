---
id: pod.web
type: pod
title: "web deployment (local k8s)"
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
        path: deploy/k8s/web.yaml
        symbol: "image: casebook:local"
        commit: 7597fc3
        urls:
          - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/deploy/k8s/web.yaml
        observedAt: 2026-10-31
        observedBy: claude


evidence:
  - source: infrastructure
    path: deploy/k8s/web.yaml
    lines: 14-60
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/deploy/k8s/web.yaml#L14-L60
    observedAt: 2026-10-31
    observedBy: claude

provenance:
  capturedBy: claude
---

# web deployment (local k8s)

The web app: `node apps/web/build` on port 3000 from `casebook:local`, config from the `casebook` ConfigMap and `casebook-db` Secret, case files on the `casebook-files` volume.
