# Roadmap

## Workstreams

1. **Define, create and store process definitions.** v1 focus. See decisions 0002 to 0008.
2. **Start and execute through a process.** Started: the case runtime and the runner screens (0022).
3. **UI options.** v1 focus: read-only graph, editor and the authoring wizard (0011, 0013).
4. **Agents in the loop via MCP.** Deferred.
5. **Build and auto-convert processes.** v1 covers spreadsheet import via the wizard; the rest is deferred.

v1 = workstreams 1 and 3, plus the spreadsheet wizard; workstream 2 has begun with running cases.

## Deferred

- **Case runtime, what is left (workstream 2).**
  Done (0022): starting cases, item status, waiting-on, guards, approvals, facts, evidence files and the runner screens.
  Still to come: notifications beyond the in-app lists, inviting guests who are not yet known to an account, evaluating role references in guards, and an object store for files.
- **Excel two-way sync ("nocell") and hooks.**
  Keep source spreadsheets in sync with case state; execute hook bindings on reserved lifecycle events (0010).
- **MCP surface (workstream 4).**
  Tools to read a process, inspect a case, list opportunities, submit evidence and record decisions, under delegation rules (0009).
- **Auto-conversion of documents (workstream 5).**
  Turn prose SOPs, PDFs and documents into drafts; publish via draft-plus-review; re-extraction shows a diff against the current version.
- **BPMN projection.**
  Generate BPMN from the canonical definition, using `data.bpmn.*` for layout metadata.
- **Per-feature-branch preview environments.**
  Deploy the full stack per branch under a temporary subdomain; tear it down on merge.
- **External IdP and SCIM.**
  Add external OIDC issuers and user/group provisioning (0008).
- **Row-level security multi-tenancy.**
  Enforce namespace isolation in Postgres when a second tenant arrives (0007).
- **OpenFGA or SpiceDB.**
  Move role-binding tuples to a dedicated authorization service.
- **docket as an evidence source.**
  Accept evidence collected by docket agents into case facts.
