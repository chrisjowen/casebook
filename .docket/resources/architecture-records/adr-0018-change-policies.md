---
id: architecture_record.adr-0018
type: architecture_record
title: "ADR 0018: Publishing under change policies: approval, attribution and living versions"

tags:
  - adr

attributes:
  number: 18
  path: docs/decisions/0018-change-policies.md
  status: accepted

links:
  - rel: stored_in
    target: repository.casebook
    evidence:
      - source: docs
        path: docs/decisions/README.md
        observedAt: 2026-10-31
        observedBy: claude
        note: Listed in casebook's decision log as Accepted.

evidence:
  - source: docs
    path: docs/decisions/0018-change-policies.md
    lines: 1-21
    symbol: "0018. Publishing under change policies: approval, attribution and living versions"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/docs/decisions/0018-change-policies.md
    observedAt: 2026-10-31
    observedBy: claude
    note: "ADR file with status line 'Accepted. Amends 0016.'."

provenance:
  capturedBy: claude
---

# ADR 0018: Publishing under change policies: approval, attribution and living versions

Casebook's architecture decision record 0018, "Publishing under change policies: approval, attribution and living versions", kept in
`docs/decisions/0018-change-policies.md` and listed in the decision log `docs/decisions/README.md`.
Status: Accepted. Amends 0016.

What it decides, condensed from its Decision section: Approval: when a governed definition requires approval, the approval must come from a user (0009) who is neither the publisher nor the principal they act for. Who is entitled to approve, such as namespace permissions (0015), is left to the permissions layer. Attribution: a publish is attributed under the same rules as an edit (0009). Living versions: every accepted edit, undo and revert included, publishes a new version straight away, even when its content matches an earlier version. Each version is made from the exact revision its edit committed. When two edits race to publish, the loser retries a bounded number of times: an older revision overtaken by a newer one reports that it is …

Its status line relates it to earlier records: [[architecture_record.adr-0016]] ("Accepted. Amends 0016.").

Captured from the ADR file during docket's initial scan; the ADR itself is
the authority for context and consequences.
