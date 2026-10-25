# 0024. The spreadsheet wizard on the board

Status: Accepted. Amends 0011, 0012 and 0013.

## Context
0011 defines the wizard and 0013 left its layout open; the graph-led layout (a canvas with a closeable slide-over assistant) was approved in review, and the editor has since become the board (0021).
Each agent turn must be reviewable as one accept/reject diff, but edits are saved as draft revisions as soon as they are made (0019, 0020).
The wizard should run on a local model while one is good enough, without tying the agent to a provider.

## Decision
- **Layout.** "Import a spreadsheet" sits beside "New process" in the process tabs. The board stays the canvas; the assistant is a slide-over beside it that can be closed and reopened. While the split is being chosen, the canvas says so instead of showing a process.
- **The split.** The agent proposes processes, each with the cell ranges it is drafted from, plus shared cells several processes draw on. The person renames, merges, splits off a range or asks in chat for a different split. Accepting it creates one governed process per proposed process, holding only its process node with a link to its cells.
- **Proposals, not edits.** In a turn the agent applies node operations through the store's definition service, which checks each batch as an edit by the signed-in person (`previewDefinitionEdit`) without saving it. The turn's operations become one proposal. The board shows the draft with the proposal applied and its new and changed cards marked, and the assistant lists the changes from the model's diff. Accept saves the operations as one draft revision against the revision the person reviewed; Reject drops them. A reply in chat revises the pending proposal into a new one.
- **Every node links to its cells.** The agent may add a node only with `core.source` naming cells of the uploaded workbook; the tool refuses a source naming another document, or sheets or cells that do not exist (for a local Ollama model it first fills in the file name).
- **Publishing** is the editor's publish, so the publish checks (0005) run as for any draft; a refusal is shown in the assistant with an "Ask the assistant to fix it" action.
- **Sessions.** An import in progress is stored in `wizard_sessions`: the workbook as read, and the wizard's state (split, chat, proposals) as JSON with a version that refuses overlapping saves. Only the person who started it can see it; starting one needs `definition.create` in the namespace.
- **The model is a setting.** The agent is deepagents (0012), shown only its own tools and instructions. Its chat model is any LangChain chat model named by `CASEBOOK_WIZARD_MODEL` as `provider:model`: `ollama:qwen2.5:7b` by default, `anthropic:…` or `openai:…`.

## Consequences
- Nothing the agent does reaches a draft until someone accepts it, and what is accepted is an ordinary revision that Undo takes back.
- A proposal is previewed against the draft as it is now, so editing by hand meanwhile is safe: if the proposal no longer applies, it can only be rejected.
- Small local models make weaker proposals and slower turns; they show up as proposals to reject rather than broken drafts.
- Two-way sync with the spreadsheet stays deferred (roadmap).
