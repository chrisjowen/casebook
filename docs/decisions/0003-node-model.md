# 0003. Node model: core, content and data

Status: Accepted

## Context
The modeler must stay generic across very different processes while still being strictly validated and extensible by projections (BPMN, Excel, UI, hooks).

## Decision
Every element (process, stage, step, fact, role, decision, approval) is a node with three layers:

- **core**: typed and schema-validated. Identity, kind, edges (requires, collects, stage membership), role, actor policy (`human`, `agent` or `either`), guards, source reference with an `inferred` flag, and invariants.
- **content**: Markdown prose guidance for people.
- **data**: an open map with namespaced keys (`bpmn.*`, `excel.*`, `ui.*`, `hooks.*`) for projections and extensions.

Edges live on nodes; the graph is derived.
Proven extensions in `data` are promoted into `core` with a schema version bump.

Illustrative step node (incident management):

```json
{
  "core": {
    "id": "step.form-working-group",
    "kind": "step",
    "stage": "stage.respond",
    "role": "role.incident-commander",
    "actor": "either",
    "requires": ["fact.severity", "fact.affected-services"],
    "collects": ["fact.working-group"],
    "guards": [
      {
        "text": "Only for SEV1 or SEV2 incidents",
        "expr": "fact.severity in ['SEV1', 'SEV2']"
      }
    ],
    "source": { "ref": "incident-runbook.md#working-group", "inferred": false }
  },
  "content": "Invite an owner from each affected service. Post the bridge link in the incident channel.",
  "data": {
    "ui.icon": "users",
    "hooks.on_completed": ["notify-status-page"]
  }
}
```

## Consequences
- The core stays small and strict; experimentation happens in `data` without schema churn.
- Projections can round-trip their own metadata via their namespace.
- Promotion from `data` to `core` needs a migration path.
