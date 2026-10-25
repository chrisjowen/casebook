# Glossary

- **Case**: the shared subject of work (a baby, an incident, a new hire). Process instances attach to it and share its facts.
- **Process**: a definition of stages, steps, facts, roles, decisions and approvals for achieving an outcome.
- **Definition version**: an immutable, published JSONB document of a process. Cases pin to one.
- **Node**: any element of a definition (process, stage, step, fact, role, decision, approval).
- **Core**: the typed, schema-validated layer of a node: identity, kind, edges, role, actor policy, guards, source, invariants.
- **Content**: the Markdown prose guidance layer of a node.
- **Data**: the open, namespaced extension layer of a node (`bpmn.*`, `excel.*`, `ui.*`, `hooks.*`).
- **Fact**: a typed value recorded once on a case, with who recorded it, when, and its evidence.
- **Evidence**: proof backing a fact, such as a document or scan, with format and copy requirements.
- **Guard**: a condition on a step or edge: prose, plus an optional safe expression over facts and roles.
- **Role**: an abstract slot in a definition (for example incident commander), filled by principals at runtime.
- **Role binding**: a `(principal, role, scope)` tuple assigning a principal to a role in a namespace or case.
- **Principal**: an actor identity: a user, group or agent, keyed by `(issuer, subject)`.
- **Delegation**: a scoped, expiring grant from a user letting an agent act on their behalf.
- **Namespace**: a hierarchical path (for example `acme/eng/sre`) that owns definitions, cases and bindings.
- **Projection**: a view generated from the canonical definition, such as Markdown, BPMN or the graph.
