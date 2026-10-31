---
id: architecture_record.adr-0020
type: architecture_record
title: "ADR 0020: Editing definitions through the store, with a dev sign-in"

tags:
  - adr

attributes:
  number: 20
  path: docs/decisions/0020-editing-through-the-store.md
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
    path: docs/decisions/0020-editing-through-the-store.md
    lines: 1-23
    symbol: "0020. Editing definitions through the store, with a dev sign-in"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/docs/decisions/0020-editing-through-the-store.md
    observedAt: 2026-10-31
    observedBy: claude
    note: "ADR file with status line 'Accepted. Amends 0019.'."

provenance:
  capturedBy: claude
---

# ADR 0020: Editing definitions through the store, with a dev sign-in

Casebook's architecture decision record 0020, "Editing definitions through the store, with a dev sign-in", kept in
`docs/decisions/0020-editing-through-the-store.md` and listed in the decision log `docs/decisions/README.md`.
Status: Accepted. Amends 0019.

What it decides, condensed from its Decision section: `@casebook/store` gets a definition service (`src/definitions.ts`) that composes the model's pure functions (`commit`, `undo`, `startHistory`, `publish`, `diff`, `checkPublish`) with the repository writes, instead of a `RevisionStore` adapter. Draft revisions also store their operations and the revision they revert to. Every read and write takes an `Actor` and checks it with `can`: namespaces the actor cannot read are hidden, and refused writes return a plain-language reason. An edit, undo or publish names the draft revision it was made against; a newer head refuses it as stale instead of overwriting or publishing what the actor did not see. The web app's sign-in is a dev-only stand-in: …

Its status line relates it to earlier records: [[architecture_record.adr-0019]] ("Accepted. Amends 0019.").

Captured from the ADR file during docket's initial scan; the ADR itself is
the authority for context and consequences.
