# 0002. Process definitions are canonical JSONB in Postgres

Status: Accepted

## Context
Definitions must be versioned, validated, and rendered in several forms (Markdown, BPMN, graph). We need one source of truth.

## Decision
Postgres is canonical.
A published definition version is an immutable JSONB document validated against a versioned process-definition JSON Schema.
Drafts are revisions of the same shape.
Cases pin to a definition version.
Markdown (front matter plus body), BPMN and the graph are projections generated from the document.
Git sync is an optional later integration.

## Consequences
- Running cases are never changed by later edits; migration between versions is explicit.
- Every view is derived, so views cannot drift from the definition.
- The definition schema itself needs versioning and migration.
