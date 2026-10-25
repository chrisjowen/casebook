# 0016. Governed and living definitions, pinned and following cases

Status: Accepted. Extends 0002.

## Context
Some processes are fixed and versioned, such as incident management. Others are one-off and change over time, such as a hospital process for one patient. Both need a full history.

## Decision
A process definition has a change policy, `governed` by default:
- **Governed**: edits go to draft revisions, and an explicit publish creates a new immutable version. Publishing may require an approval; for now only that policy flag is recorded.
- **Living**: every accepted edit is published as a new immutable version. Checks are warnings, not blockers.

Storage is the same for both: immutable versions and the full revision history, with each version recording the revision it was published from. A version published from a revision takes that revision's body.

A case binds a version as `pinned` or `follow_latest`.
The default follows the definition's policy: pinned for governed, following for living.
`definition_version_id` is the currently bound version.
A following case moves to each newly published version.
Moving a pinned case to a newer version is an explicit action, recorded with who, when, from and to.
A case only binds a published version, and a following case starts on the latest published one.
A case lives in its definition's namespace or one of its descendants, never in another account.

Future only: ad-hoc steps on a single case, and saving a living process as a governed template.

## Consequences
- One storage model serves both kinds of process; only the publish trigger differs.
- A pinned case never changes underneath its participants; a following case always reads its definition's latest version.
- The approval flow for governed publishes is still to be designed.
