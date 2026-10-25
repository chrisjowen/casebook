# 0004. Guards start loose

Status: Accepted

## Context
Source SOPs state conditions in prose. Forcing a formal expression up front would block authoring and invite wrong guesses.

## Decision
A guard is prose text plus an optional structured expression in a small safe language (CEL or JSONLogic style) over case facts and roles.
With only prose, the engine surfaces an open decision to the responsible role rather than guessing.
Repeating steps use an `until` condition.

## Consequences
- Definitions are publishable before they are fully formalized.
- Formalization can be incremental, guard by guard.
- The expression language must be chosen and sandboxed (deferred to implementation).
