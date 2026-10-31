---
id: architecture_record.adr-0021
type: architecture_record
title: "ADR 0021: Building a process on the board"

tags:
  - adr

attributes:
  number: 21
  path: docs/decisions/0021-building-on-the-board.md
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
    path: docs/decisions/0021-building-on-the-board.md
    lines: 1-29
    symbol: "0021. Building a process on the board"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/docs/decisions/0021-building-on-the-board.md
    observedAt: 2026-10-31
    observedBy: claude
    note: "ADR file with status line 'Accepted. Amends 0013 and 0019.'."

provenance:
  capturedBy: claude
---

# ADR 0021: Building a process on the board

Casebook's architecture decision record 0021, "Building a process on the board", kept in
`docs/decisions/0021-building-on-the-board.md` and listed in the decision log `docs/decisions/README.md`.
Status: Accepted. Amends 0013 and 0019.

What it decides, condensed from its Decision section: The step-cards view becomes the board, where processes are built. Each stage is a column in stage order, shown even when empty, with an "Add stage" column after the last. Cards are laid out from the definition alone, so nothing about positions is stored and a process the wizard agent writes looks the same as one built by hand. Role lanes and fact flow stay as read-only lenses. Everything is added, linked and named in place: a stage's "+" and "Add step", a card's "+", right-click menus, dragging a card's dot into space, dragging a card onto another stage, double-clicking a name, and a palette. Each gesture asks for the name first and is saved as one edit, so one undo takes it back. A link is …

Its status line relates it to earlier records: [[architecture_record.adr-0013]], [[architecture_record.adr-0019]] ("Accepted. Amends 0013 and 0019.").

Captured from the ADR file during docket's initial scan; the ADR itself is
the authority for context and consequences.
