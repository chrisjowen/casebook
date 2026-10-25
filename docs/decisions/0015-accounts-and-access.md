# 0015. Accounts, account roles and namespace permissions

Status: Accepted. Amends 0007 and 0008.

## Context
0007 gives namespaces but not who may create or manage them. 0008 gives role-binding tuples but no built-in roles for managing the service itself. We follow the Temporal Cloud model: an account at the top, account-level roles, and permissions per namespace.

## Decision
An account is the top-level tenant.
Every namespace belongs to exactly one account, and a child namespace sits in its parent's account.
Namespace paths are unique per account.
Principals become members of an account by holding an account-level role.

Account roles are built in and fixed:
- `account-owner`: everything, including membership. The user who creates an account becomes its first owner.
- `account-admin`: manages members and namespaces, and is implicitly namespace-admin on every namespace in the account.
- `developer`: creates namespaces and becomes namespace-admin of each one they create.
- `read-only`.

Namespace permissions are built in and fixed, and apply to descendant namespaces:
- `namespace-admin`: manage the namespace and its permissions.
- `write`: create and edit process definitions in the namespace.
- `read`.

Creating a namespace needs developer or above in the account, or namespace-admin on the parent or one of its ancestors.
The creator is bound as namespace-admin of the new namespace.

Both kinds of role live in the existing role-binding tuples, which gain an `account` scope beside `namespace` and `case`; there are no separate access tables.
Account scope takes only account roles.
Namespace scope takes namespace permissions and standing process roles (0008).
Case scope takes process roles only.
Accounts, namespaces and process definitions record who created them.

## Consequences
- Namespace management has an owner from the first migration, and a second tenant is a second account.
- The built-in role names are reserved and cannot be used as process role names at the scopes that take them.
- The store checks only what namespace creation needs. Resolving "can principal X do Y" in general, including the implicit account-admin rule, is the later permissions task.
