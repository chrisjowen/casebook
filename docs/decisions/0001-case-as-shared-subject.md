# 0001. A case is the shared subject

Status: Accepted

## Context
Real processes rarely stand alone. A newborn needs birth registration, passports, a residence pass and medical claims; an incident needs classification, a working group, resolution and an RCA. These share the same facts.

## Decision
A case is the shared subject (a baby, an incident, a new hire).
Several process instances attach to one case and share one fact store.
A fact is recorded once, with who recorded it, when, and its backing evidence.

## Consequences
- Facts collected by one process satisfy requirements in another without re-entry.
- Provenance (actor, time, evidence) is part of every fact, not an add-on.
- The case, not the process instance, is the unit of storage and access.
