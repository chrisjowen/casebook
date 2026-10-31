---
id: architecture_record.adr-0026
type: architecture_record
title: "ADR 0026: Saving a task for later and asking for information on it"

tags:
  - adr

attributes:
  number: 26
  path: docs/decisions/0026-saving-and-asking-on-a-task.md
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
    path: docs/decisions/0026-saving-and-asking-on-a-task.md
    lines: 1-21
    symbol: "0026. Saving a task for later and asking for information on it"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/docs/decisions/0026-saving-and-asking-on-a-task.md
    observedAt: 2026-10-31
    observedBy: claude
    note: "ADR file with status line 'Accepted. Amends 0022.'."

provenance:
  capturedBy: claude
---

# ADR 0026: Saving a task for later and asking for information on it

Casebook's architecture decision record 0026, "Saving a task for later and asking for information on it", kept in
`docs/decisions/0026-saving-and-asking-on-a-task.md` and listed in the decision log `docs/decisions/README.md`.
Status: Accepted. Amends 0022.

What it decides, condensed from its Decision section: Starting a case is a guided flow of three steps on one form: what to run, which case it is for and who's who, then a check of what happens next. Starting it goes straight to the first task when that task is the starter's and ready, otherwise to the case. A task is one focused page: its stage strip and status, its form with one action bar (Complete, Save for later, I can't finish this yet), its questions, and a rail listing the process's other work by stage. After completing it the page hands over to the user's next ready task, on the same case first. Saving records `step.saved` with the form's typed values: as people type (after a short pause, and when they leave the page), and on Save for …

Its status line relates it to earlier records: [[architecture_record.adr-0022]] ("Accepted. Amends 0022.").

Captured from the ADR file during docket's initial scan; the ADR itself is
the authority for context and consequences.
