# 0005. Publish-time invariant checks

Status: Accepted

## Context
Drafts may be inconsistent; published versions must be runnable.

## Decision
Publishing a definition runs invariant checks:

- no dependency cycles;
- every required fact is collected somewhere;
- every role is declared;
- every guard expression references only known facts.

## Consequences
- Publish can fail; the editor and wizard must show violations clearly.
- Human and agent edits share the same validation.
