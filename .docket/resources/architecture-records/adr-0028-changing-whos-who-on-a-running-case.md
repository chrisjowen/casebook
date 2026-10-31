---
id: architecture_record.adr-0028
type: architecture_record
title: "ADR 0028: Changing who's who on a running case"

tags:
  - adr

attributes:
  number: 28
  path: docs/decisions/0028-changing-whos-who-on-a-running-case.md
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
    path: docs/decisions/0028-changing-whos-who-on-a-running-case.md
    lines: 1-19
    symbol: "0028. Changing who's who on a running case"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/docs/decisions/0028-changing-whos-who-on-a-running-case.md
    observedAt: 2026-10-31
    observedBy: claude
    note: "ADR file with status line 'Accepted. Amends 0017 and 0022.'."

provenance:
  capturedBy: claude
---

# ADR 0028: Changing who's who on a running case

Casebook's architecture decision record 0028, "Changing who's who on a running case", kept in
`docs/decisions/0028-changing-whos-who-on-a-running-case.md` and listed in the decision log `docs/decisions/README.md`.
Status: Accepted. Amends 0017 and 0022.

What it decides, condensed from its Decision section: Who's who is a panel on the case workspace. It lists every role the case's processes declare, with the people named for it on the case and anyone holding it as a standing role on the case's namespace or an ancestor. A role nobody holds is highlighted with the ready and paused tasks waiting on it. A new action, `case.manage_roles` on a case, needs namespace-admin on the case's namespace or an ancestor, which account owners and admins hold everywhere (0015). Everyone else who can open the case sees the panel read-only; guests never open the case workspace, so never see it. A change sets the role's holders on the case: naming, replacing and removing are one write that binds and unbinds …

Its status line relates it to earlier records: [[architecture_record.adr-0017]], [[architecture_record.adr-0022]] ("Accepted. Amends 0017 and 0022.").

Captured from the ADR file during docket's initial scan; the ADR itself is
the authority for context and consequences.
