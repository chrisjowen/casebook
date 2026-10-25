# 0014. Synthetic sample data only

Status: Accepted

## Context
Test cases come from real life (for example a household newborn tracker), which contains personal data.

## Decision
Sample data uses synthetic names and numbers only.
Real personal spreadsheets are never committed.

## Consequences
- Fixtures must be built or anonymized before use.
- Reviews should reject commits containing real personal data.
