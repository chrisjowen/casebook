# 0013. Graph default view and wizard layout

Status: Accepted

## Context
The right default graph view and wizard layout were not obvious, so a throwaway prototype compared:

Graph views:
- A: step cards in stage containers, fact-derived edges, click-through side sheet.
- B: role swimlanes.
- C: fact flow, with facts as nodes.
- Plus a multi-process overview map.

Wizard layouts:
- 1: chat-led single column with an inline expandable graph.
- 2: graph-led canvas with a slide-over chat.

Calm, low-noise layouts are preferred.

## Decision
- The editor is definition-editing mode only, with no cases or instances.
- Step cards (A) is the default view. Role lanes (B) and fact flow (C) are switchable views, alongside the process map with shared fact types.
- Clicking a node opens a definition inspector, not a form.
- The wizard layout is deferred to phase 2. Its prototype layouts stay as reference.
- Run time will be a per-user task list showing one form per task, with a light progress indicator rather than the full graph.

## Consequences
- The editor build starts from view A, with B, C and the map as alternatives.
- Nothing in the editor shows case or instance data.
- The wizard layout is decided when phase 2 starts.
- The run-time UI is designed around tasks, not the process graph.
