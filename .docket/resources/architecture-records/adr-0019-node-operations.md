---
id: architecture_record.adr-0019
type: architecture_record
title: "ADR 0019: Node operations: checks, history and undo"

tags:
  - adr

attributes:
  number: 19
  path: docs/decisions/0019-node-operations.md
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
    path: docs/decisions/0019-node-operations.md
    lines: 1-32
    symbol: "0019. Node operations: checks, history and undo"
    commit: 7597fc3
    urls:
      - https://github.com/chrisjowen/casebook/blob/7597fc3c463e4a450f54f39ef96faf5233363a69/docs/decisions/0019-node-operations.md
    observedAt: 2026-10-31
    observedBy: claude
    note: "ADR file with status line 'Accepted'."

provenance:
  capturedBy: claude
---

# ADR 0019: Node operations: checks, history and undo

Casebook's architecture decision record 0019, "Node operations: checks, history and undo", kept in
`docs/decisions/0019-node-operations.md` and listed in the decision log `docs/decisions/README.md`.
Status: Accepted

What it decides, condensed from its Decision section: Operations are `add_node`, `remove_node`, `update_core`, `set_content`, `set_data`, `link`, `unlink` and `move_to_stage`, each with a JSON Schema the agent can use as a tool definition. Every operation is checked against the whole resulting document: Rejected: a schema violation, or a reference to a stage, fact or approval that does not exist, a duplicate id, or a missing or second process node. The rejection says why in plain language. Warnings: draft incompleteness, such as a required fact nothing collects, an undeclared role, a guard naming an unknown fact, a dependency cycle or an empty stage. These block only at publish, and only those of error severity. `remove_node` refuses while …

Captured from the ADR file during docket's initial scan; the ADR itself is
the authority for context and consequences.
