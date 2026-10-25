# Decision log

Architecture decisions for casebook, one file per decision.

| # | Decision | Status |
|---|---|---|
| 0001 | [A case is the shared subject](0001-case-as-shared-subject.md) | Accepted |
| 0002 | [Process definitions are canonical JSONB in Postgres](0002-definition-storage.md) | Accepted |
| 0003 | [Node model: core, content and data](0003-node-model.md) | Accepted |
| 0004 | [Guards start loose](0004-guards.md) | Accepted |
| 0005 | [Publish-time invariant checks](0005-publish-invariants.md) | Accepted |
| 0006 | [Fact types are JSON Schema with extensions](0006-fact-types.md) | Accepted |
| 0007 | [Hierarchical namespaces from day one](0007-namespaces.md) | Accepted |
| 0008 | [Principals, roles and role bindings](0008-identity-and-roles.md) | Accepted |
| 0009 | [Agents are first-class principals with delegation](0009-agents-as-principals.md) | Accepted |
| 0010 | [Lifecycle event names reserved for hooks](0010-reserved-lifecycle-events.md) | Accepted |
| 0011 | [v1 authoring wizard](0011-v1-wizard.md) | Accepted |
| 0012 | [Technology stack](0012-stack.md) | Accepted |
| 0013 | [Graph default view and wizard layout](0013-graph-view-and-wizard-layout.md) | Accepted |
| 0014 | [Synthetic sample data only](0014-synthetic-sample-data.md) | Accepted |
| 0015 | [Accounts, account roles and namespace permissions](0015-accounts-and-access.md) | Accepted |
| 0016 | [Governed and living definitions, pinned and following cases](0016-change-policies.md) | Accepted |
| 0017 | [Permission resolution](0017-permission-resolution.md) | Accepted |
| 0018 | [Publishing under change policies: approval, attribution and living versions](0018-change-policies.md) | Accepted (amends 0016) |
| 0019 | [Node operations: checks, history and undo](0019-node-operations.md) | Accepted |
| 0020 | [Editing definitions through the store, with a dev sign-in](0020-editing-through-the-store.md) | Accepted (amends 0019) |
