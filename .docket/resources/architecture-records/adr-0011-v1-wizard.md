---
id: architecture_record.adr-0011
type: architecture_record
title: "ADR 0011: v1 authoring wizard"

tags:
  - adr

attributes:
  number: 11
  path: docs/decisions/0011-v1-wizard.md
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
    path: docs/decisions/0011-v1-wizard.md
    lines: 1-23
    symbol: "0011. v1 authoring wizard"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/docs/decisions/0011-v1-wizard.md
    observedAt: 2026-10-31
    observedBy: claude
    note: "ADR file with status line 'Accepted'."

provenance:
  capturedBy: claude
---

# ADR 0011: v1 authoring wizard

Casebook's architecture decision record 0011, "v1 authoring wizard", kept in
`docs/decisions/0011-v1-wizard.md` and listed in the decision log `docs/decisions/README.md`.
Status: Accepted

What it decides, condensed from its Decision section: 1. The user uploads a spreadsheet. 2. The authoring agent proposes how to split it into processes; the user accepts, merges, splits or renames. 3. The agent drafts nodes; the user pushes back in chat. 4. Each agent turn is presented as an accept/reject diff. 5. Publish runs the invariants (see 0005). The agent edits only through typed node operations (`add_node`, `update_core`, `link`, ...) validated by the same layer as human edits. Every node links back to its source cells. Excel is import-only in v1.

Captured from the ADR file during docket's initial scan; the ADR itself is
the authority for context and consequences.
