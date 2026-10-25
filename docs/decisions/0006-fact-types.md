# 0006. Fact types are JSON Schema with extensions

Status: Accepted

## Context
Facts need types, forms, lookups, proof requirements and sensitivity labels, using a standard where possible.

## Decision
Fact types are JSON Schema 2020-12 plus extensions:

- `x-lookup`: reference datasets, principals filtered by role, other facts or cases, later external connectors.
- `x-evidence`: required proof, including format and copy count.
- `x-sensitivity`: PII levels.

Shared types live in a namespace-level type library reused via `$ref`.
Reference datasets are namespace-level and versioned.
Forms render from the schema, with layout hints in `data.ui.*`.

## Consequences
- Standard validators and form tooling apply.
- Extensions need custom handling in validators and renderers.
- Sensitivity labels enable later redaction and access rules.
