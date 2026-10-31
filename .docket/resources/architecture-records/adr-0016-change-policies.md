---
id: architecture_record.adr-0016
type: architecture_record
title: "ADR 0016: Governed and living definitions, pinned and following cases"

tags:
  - adr

attributes:
  number: 16
  path: docs/decisions/0016-change-policies.md
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
    path: docs/decisions/0016-change-policies.md
    lines: 1-29
    symbol: "0016. Governed and living definitions, pinned and following cases"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/docs/decisions/0016-change-policies.md
    observedAt: 2026-10-31
    observedBy: claude
    note: "ADR file with status line 'Accepted. Extends 0002.'."

provenance:
  capturedBy: claude
---

# ADR 0016: Governed and living definitions, pinned and following cases

Casebook's architecture decision record 0016, "Governed and living definitions, pinned and following cases", kept in
`docs/decisions/0016-change-policies.md` and listed in the decision log `docs/decisions/README.md`.
Status: Accepted. Extends 0002.

What it decides, condensed from its Decision section: A process definition has a change policy, `governed` by default: Governed: edits go to draft revisions, and an explicit publish creates a new immutable version. Publishing may require an approval; who may approve is decided in 0018. Living: every accepted edit is published as a new immutable version. Checks are warnings, not blockers. Storage is the same for both: immutable versions and the full revision history, with each version recording the revision it was published from. A version published from a revision takes that revision's body. A case binds a version as `pinned` or `follow_latest`. The default follows the definition's policy: pinned for governed, following for living. …

Its status line relates it to earlier records: [[architecture_record.adr-0002]] ("Accepted. Extends 0002.").

Captured from the ADR file during docket's initial scan; the ADR itself is
the authority for context and consequences.
