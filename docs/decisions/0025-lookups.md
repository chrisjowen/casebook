# 0025. Lookups: lists of values for choice facts

Status: Accepted. Amends 0003 and 0006.

## Context
Choice facts carried their options inline (`enum` on the fact's schema), edited as a comma list.
ADR 0006 names namespace-level reference datasets (`x-lookup: { kind: 'dataset' }`), and two fixtures point at them, but nothing stored them or let anyone edit them.
Lists such as severities, countries, insurers and document types need to be defined once, reused, reordered, retired without breaking cases that hold old values, and seen where they are used.

## Decision
- A **lookup** is a named list of values. Each value has:
  - a stored `value`, which cases hold and conditions compare, and which never changes once in use;
  - an optional `label` that people read;
  - an optional `code`, such as an ISO code;
  - a `disabled` flag. A turned-off value is not offered for new entries, but cases that already hold it still read correctly and can keep it.
- A **process lookup** is a new node kind, `lookup` (`lookup.severity-levels`).
  - A fact chooses from it with `x-lookup: { kind: 'lookup', lookup: <id> }`.
  - Because it is a node, every change is a node operation (`add_node`, `update_core`, `remove_node`). It goes through draft revisions, undo, the diff and publish like any other node, and a published version pins it.
  - The reference is a graph edge:
    - a missing lookup rejects the edit;
    - removing a lookup that is still in use is refused;
    - "where used" is read from the references.
- A **shared lookup** is the namespace-level dataset 0006 describes.
  - It is kept in the store with numbered versions, and every saved change is a new version.
  - It follows the living change policy: processes always choose from its latest version, and undo adds a version restoring the one before. The `version` on a dataset reference is kept for reference only.
  - A process sees the shared lookups of its namespace and every ancestor; the nearest one wins when two have the same name.
  - Changing them needs the new `lookup.edit` permission, which is `write` on the namespace. Reading them needs `definition.read`.
  - A shared lookup cannot be deleted while a process's draft, any of its published versions, or a live case chooses from it. To retire a list that is still in use, turn its values off: new choices stop offering them, and cases that hold them still read them.
- Inline `enum` options stay as they are. The editor turns them into a lookup in one edit.
- Publish checks:
  - a value stored twice in one lookup is an error;
  - a lookup that a fact uses but that has no value left to choose is an error;
  - a lookup nothing uses is a warning.
- Case forms:
  - offer the values by label, store the value, and refuse a value outside the list;
  - offer a turned-off value only when the case already holds it.
  - The case record shows labels.

## Consequences
- Renaming a value never rewrites case data or conditions. Only removing a value can leave a case holding something no longer listed, which then reads as stored.
- A shared lookup changes processes that are already published, without a publish, so its versions and history are the audit trail. Pinning a process to a version of a shared lookup is left for later.
- Conditions over a lookup-backed fact compare stored values, so a condition builder should offer the labels and write the values.
