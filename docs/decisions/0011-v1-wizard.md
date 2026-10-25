# 0011. v1 authoring wizard

Status: Accepted

## Context
Many real processes live in spreadsheets. The first authoring path should turn one into definitions with a human in control.

## Decision
1. The user uploads a spreadsheet.
2. The authoring agent proposes how to split it into processes; the user accepts, merges, splits or renames.
3. The agent drafts nodes; the user pushes back in chat.
4. Each agent turn is presented as an accept/reject diff.
5. Publish runs the invariants (see 0005).

The agent edits only through typed node operations (`add_node`, `update_core`, `link`, ...) validated by the same layer as human edits.
Every node links back to its source cells.
Excel is import-only in v1.

## Consequences
- Agent output is reviewable and reversible.
- One operation layer serves UI, agent and later MCP.
- Two-way sync is deferred (see roadmap).
