# 0010. Lifecycle event names reserved for hooks

Status: Accepted

## Context
Hooks (for example updating a source spreadsheet) are wanted but not in v1.

## Decision
Lifecycle event names are reserved now: `case.opened`, `fact.recorded`, `step.completed`, `decision.made`, and similar.
Nodes may carry hook bindings in `data.hooks.*`.
Nothing executes them in v1.

## Consequences
- Definitions authored now remain valid when hooks ship.
- The event log can be shaped around these names from the start.
