# 0007. Hierarchical namespaces from day one

Status: Accepted

## Context
The goal is a central SaaS or in-house service where processes belong to departments, teams or individuals.

## Decision
Namespaces are hierarchical paths (for example `acme/eng/sre` or `personal/<user>/family`).
Definitions, cases and role bindings carry a namespace from the first migration.
We run a single deployment first and add row-level security when a second tenant arrives.

## Consequences
- No retrofit of ownership later.
- Lookups (types, datasets, role bindings) can inherit along the path.
- Tenant isolation is deferred, not designed out.
