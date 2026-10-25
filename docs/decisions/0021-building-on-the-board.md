# 0021. Building a process on the board

Status: Accepted. Amends 0013 and 0019.

## Context
Editing (0020) worked through node menus and inspectors around a read-only graph.
In review it was hard to build with: stages could only be added from the process inspector and did not show on the graph until they held a step, steps could only be added from another step's menu, and a link could only be made by picking a fact in the target's inspector.
The left icon rail and outline only repeated the tabs and the graph, and changed the right-hand inspector.
A throwaway prototype compared a structured board (stages as columns laid out automatically) with a free canvas (stages as frames, cards placed by hand), and the board was chosen.

## Decision
- The step-cards view becomes the **board**, where processes are built.
  Each stage is a column in stage order, shown even when empty, with an "Add stage" column after the last.
  Cards are laid out from the definition alone, so nothing about positions is stored and a process the wizard agent writes looks the same as one built by hand.
  Role lanes and fact flow stay as read-only lenses.
- Everything is added, linked and named in place: a stage's "+" and "Add step", a card's "+", right-click menus, dragging a card's dot into space, dragging a card onto another stage, double-clicking a name, and a palette.
  Each gesture asks for the name first and is saved as one edit, so one undo takes it back.
- **A link is a hand-off of facts** (0003): dragging a step onto another makes the second need what the first records; dragging a fact onto a step makes it need that fact; dragging a decision's choice makes the step run only for that choice.
  Every link gesture is a `requires`, `collects` or condition edit, never a stored edge.
- A step's **Records** and **Needs first** are where its facts are added (by name and kind; an existing fact of that name is reused), renamed, re-kinded and removed.
  Picking from the facts that exist is a secondary way in.
- The icon rail and outline are dropped. The workspace switch and "New process" sit in the tab row; the process details list every stage and fact.
- Node operations gain `move_stage`, and the diff reports a change of stage order, since stages run in that order.

## Consequences
- Someone who cannot edit sees the same board without its controls.
- Free placement of cards is not supported; stage order and dependency order decide where a card sits.
- An edit the model accepts but that blocks publishing, such as steps that wait for each other, is flagged when it is made rather than only at publish.
