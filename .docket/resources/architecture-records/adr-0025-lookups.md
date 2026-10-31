---
id: architecture_record.adr-0025
type: architecture_record
title: "ADR 0025: Lookups: lists of values for choice facts"

tags:
  - adr

attributes:
  number: 25
  path: docs/decisions/0025-lookups.md
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
    path: docs/decisions/0025-lookups.md
    lines: 1-43
    symbol: "0025. Lookups: lists of values for choice facts"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/docs/decisions/0025-lookups.md
    observedAt: 2026-10-31
    observedBy: claude
    note: "ADR file with status line 'Accepted. Amends 0003 and 0006.'."

provenance:
  capturedBy: claude
---

# ADR 0025: Lookups: lists of values for choice facts

Casebook's architecture decision record 0025, "Lookups: lists of values for choice facts", kept in
`docs/decisions/0025-lookups.md` and listed in the decision log `docs/decisions/README.md`.
Status: Accepted. Amends 0003 and 0006.

What it decides, condensed from its Decision section: A lookup is a named list of values. Each value has: a stored `value`, which cases hold and conditions compare, and which never changes once in use; an optional `label` that people read; an optional `code`, such as an ISO code; a `disabled` flag. A turned-off value is not offered for new entries, but cases that already hold it still read correctly and can keep it. A process lookup is a new node kind, `lookup` (`lookup.severity-levels`). A fact chooses from it with `x-lookup: { kind: 'lookup', lookup: <id> }`. Because it is a node, every change is a node operation (`add_node`, `update_core`, `remove_node`). It goes through draft revisions, undo, the diff and publish like any other node, and a …

Its status line relates it to earlier records: [[architecture_record.adr-0003]], [[architecture_record.adr-0006]] ("Accepted. Amends 0003 and 0006.").

Captured from the ADR file during docket's initial scan; the ADR itself is
the authority for context and consequences.
