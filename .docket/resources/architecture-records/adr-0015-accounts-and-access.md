---
id: architecture_record.adr-0015
type: architecture_record
title: "ADR 0015: Accounts, account roles and namespace permissions"

tags:
  - adr

attributes:
  number: 15
  path: docs/decisions/0015-accounts-and-access.md
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
    path: docs/decisions/0015-accounts-and-access.md
    lines: 1-38
    symbol: "0015. Accounts, account roles and namespace permissions"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/docs/decisions/0015-accounts-and-access.md
    observedAt: 2026-10-31
    observedBy: claude
    note: "ADR file with status line 'Accepted. Amends 0007 and 0008.'."

provenance:
  capturedBy: claude
---

# ADR 0015: Accounts, account roles and namespace permissions

Casebook's architecture decision record 0015, "Accounts, account roles and namespace permissions", kept in
`docs/decisions/0015-accounts-and-access.md` and listed in the decision log `docs/decisions/README.md`.
Status: Accepted. Amends 0007 and 0008.

What it decides, condensed from its Decision section: An account is the top-level tenant. Every namespace belongs to exactly one account, and a child namespace sits in its parent's account. Namespace paths are unique per account. Principals become members of an account by holding an account-level role. Account roles are built in and fixed: `account-owner`: everything, including membership. The user who creates an account becomes its first owner. `account-admin`: manages members and namespaces, and is implicitly namespace-admin on every namespace in the account. `developer`: creates namespaces and becomes namespace-admin of each one they create. `read-only`. Namespace permissions are built in and fixed, and apply to descendant namespaces: …

Its status line relates it to earlier records: [[architecture_record.adr-0007]], [[architecture_record.adr-0008]] ("Accepted. Amends 0007 and 0008.").

Captured from the ADR file during docket's initial scan; the ADR itself is
the authority for context and consequences.
