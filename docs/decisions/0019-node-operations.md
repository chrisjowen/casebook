# 0019. Node operations: checks, history and undo

Status: Accepted

## Context
The editor UI and the wizard agent change drafts only through typed node operations (0011).
Drafts may be incomplete (0005), but some edits leave a definition broken rather than unfinished.

## Decision
Operations are `add_node`, `remove_node`, `update_core`, `set_content`, `set_data`, `link`, `unlink` and `move_to_stage`, each with a JSON Schema the agent can use as a tool definition.
Every operation is checked against the whole resulting document:

- **Rejected**: a schema violation, or a reference to a stage, fact or approval that does not exist, a duplicate id, or a missing or second process node.
  The rejection says why in plain language.
- **Warnings**: draft incompleteness, such as a required fact nothing collects, an undeclared role, a guard naming an unknown fact, a dependency cycle or an empty stage.
  These block only at publish, and only those of error severity.

`remove_node` refuses while other nodes refer to the node, listing each reference; it never unlinks anything implicitly.
`update_core` is a JSON Merge Patch (RFC 7386); a node's id and kind cannot change.
A batch of operations, such as one agent turn, applies atomically: all of it or none.

Every accepted edit is a new numbered draft revision recording its operations, its author and, for an agent or service, who it acted on behalf of (0009).
Undo and revert add a revision that restores an earlier document, so history only grows.

## Consequences
- A draft is always schema-valid and free of broken references, so incomplete drafts are still safe to view and diff.
- Removing a widely used node takes several operations, which a batch keeps atomic.
- Renaming a node id is not supported yet.
- Persistence sits behind a `RevisionStore` interface in `@casebook/model`.
  The follow-up is a `RevisionStore` adapter in `@casebook/store` over its merged definition tables; revisions also need their operations and revert target stored.
  The store spells the case binding `follow_latest` where the model's `CaseVersionBinding` uses `follow-latest`, so the adapter maps between them.
