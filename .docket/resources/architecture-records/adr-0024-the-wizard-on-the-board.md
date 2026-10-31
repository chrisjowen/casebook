---
id: architecture_record.adr-0024
type: architecture_record
title: "ADR 0024: The spreadsheet wizard on the board"

tags:
  - adr

attributes:
  number: 24
  path: docs/decisions/0024-the-wizard-on-the-board.md
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
    path: docs/decisions/0024-the-wizard-on-the-board.md
    lines: 1-24
    symbol: "0024. The spreadsheet wizard on the board"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/docs/decisions/0024-the-wizard-on-the-board.md
    observedAt: 2026-10-31
    observedBy: claude
    note: "ADR file with status line 'Accepted. Amends 0011, 0012 and 0013.'."

provenance:
  capturedBy: claude
---

# ADR 0024: The spreadsheet wizard on the board

Casebook's architecture decision record 0024, "The spreadsheet wizard on the board", kept in
`docs/decisions/0024-the-wizard-on-the-board.md` and listed in the decision log `docs/decisions/README.md`.
Status: Accepted. Amends 0011, 0012 and 0013.

What it decides, condensed from its Decision section: Layout. "Import a spreadsheet" sits beside "New process" in the process tabs. The board stays the canvas; the assistant is a slide-over beside it that can be closed and reopened. While the split is being chosen, the canvas says so instead of showing a process. The split. The agent proposes processes, each with the cell ranges it is drafted from, plus shared cells several processes draw on. The person renames, merges, splits off a range or asks in chat for a different split. Accepting it creates one governed process per proposed process, holding only its process node with a link to its cells. Proposals, not edits. In a turn the agent applies node operations through the store's definition …

Its status line relates it to earlier records: [[architecture_record.adr-0011]], [[architecture_record.adr-0012]], [[architecture_record.adr-0013]] ("Accepted. Amends 0011, 0012 and 0013.").

Captured from the ADR file during docket's initial scan; the ADR itself is
the authority for context and consequences.
