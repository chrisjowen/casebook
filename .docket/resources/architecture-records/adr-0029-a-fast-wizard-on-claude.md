---
id: architecture_record.adr-0029
type: architecture_record
title: "ADR 0029: A fast wizard on Claude, shown as it works"

tags:
  - adr

attributes:
  number: 29
  path: docs/decisions/0029-a-fast-wizard-on-claude.md
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
    path: docs/decisions/0029-a-fast-wizard-on-claude.md
    lines: 1-27
    symbol: "0029. A fast wizard on Claude, shown as it works"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/docs/decisions/0029-a-fast-wizard-on-claude.md
    observedAt: 2026-10-31
    observedBy: claude
    note: "ADR file with status line 'Accepted. Amends 0024.'."

provenance:
  capturedBy: claude
---

# ADR 0029: A fast wizard on Claude, shown as it works

Casebook's architecture decision record 0029, "A fast wizard on Claude, shown as it works", kept in
`docs/decisions/0029-a-fast-wizard-on-claude.md` and listed in the decision log `docs/decisions/README.md`.
Status: Accepted. Amends 0024.

What it decides, condensed from its Decision section: Claude when it is chosen. The wizard runs on Claude only when `CASEBOOK_WIZARD_MODEL` names it, such as `anthropic:claude-sonnet-5` with `ANTHROPIC_API_KEY` set; unset, it stays on `ollama:qwen2.5:7b`, so a workbook goes to a hosted model only by choice. Low effort. Claude runs at the effort `low` on the models that take one. The sample's drafts kept the same processes and number of operations at `low` as at `high`. Fewer round trips. Each draft-phase request carries the draft as it stands, so the agent starts proposing without reading it first. A hosted model is asked for a process's whole draft in one `apply_operations` call. A local model is still asked for one kind of node at a time. …

Its status line relates it to earlier records: [[architecture_record.adr-0024]] ("Accepted. Amends 0024.").

Captured from the ADR file during docket's initial scan; the ADR itself is
the authority for context and consequences.
