# 0017. Publishing under change policies: approval, attribution and living versions

Status: Accepted. Amends 0016.

## Context
0016 decides the change policies, `governed` and `living`, and how cases bind versions.
It leaves open who may approve a governed publish, how a publish is attributed, and what a living definition does when edits undo one another or race to publish.

## Decision
- **Approval**: when a governed definition requires approval, the approval must come from a user (0009) who is neither the publisher nor the principal they act for.
  Who is entitled to approve, such as namespace permissions (0015), is left to the permissions layer.
- **Attribution**: a publish is attributed under the same rules as an edit (0009).
- **Living versions**: every accepted edit, undo and revert included, publishes a new version straight away, even when its content matches an earlier version.
  Each version is made from the exact revision its edit committed.
  When two edits race to publish, the loser retries a bounded number of times: an older revision overtaken by a newer one reports that it is already superseded, which is not an error, and a newer revision publishes after the older one, so the newest accepted edit goes live.

## Consequences
- An approval cannot be self-granted or given by an agent, service or group.
- Living versions can carry known problems, so viewers must show the recorded warnings.
- A living history can hold versions with identical content, one per accepted edit.
