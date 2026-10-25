# 0017. Change policies: governed and living definitions

Status: Accepted. Extends 0016.

## Context
Some processes are fixed and versioned, such as incident management: changes are reviewed and released.
Others are one-off and change while they run, such as a hospital stay.
A single draft-then-publish flow fits the first and gets in the way of the second.

## Decision
Each definition has a change policy, `governed` or `living`.

- **Governed**: edits build up in the draft; an explicit publish makes the next numbered version, optionally only after an approval.
  Publish refuses while any publish check (0005) fails.
  An approval must come from a user (0009) who is neither the publisher nor the principal they act for; who is entitled to approve is left to the permissions layer.
- **Living**: every accepted edit publishes a new version straight away.
  Publish-check failures are recorded on the version as warnings instead of refusing it.
  Each version is made from the exact revision its edit committed; an edit that loses a race to publish keeps its revision and reports the refusal.

A publish is attributed under the same rules as an edit (0009).

Under both, a published version is immutable and a schema-invalid document is never published.
A case is pinned to a version or follows the latest one: pinned by default for governed definitions, following the latest for living ones.
Moving a pinned case to a newer version is an explicit, recorded action.

## Consequences
- Running cases of governed definitions are unaffected by later edits, as in 0002; living cases see each change.
- Living versions can carry known problems, so viewers must show the recorded warnings.
- Future work: ad-hoc steps on a single case, and saving a living process as a governed template.
- The store needs a policy per definition and a version binding per case.
