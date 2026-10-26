# 0029. A fast wizard on Claude, shown as it works

Status: Accepted. Amends 0024.

## Context
The wizard was tuned for a small local model (0024): one turn at a time on Ollama, a large workbook summarised, an 8-minute timeout.
Run on Claude (`anthropic:claude-sonnet-5`), a split still took about 14 seconds and drafting the sample's first process about 90, with only "Thinking (step N)" in the panel until the turn ended.
Timing each model call showed where the time went:
- Sonnet 5 thinks before it answers, at effort `high` unless told otherwise. One draft call spent about 5,800 of its 6,200 output tokens (55 seconds) thinking, unseen.
- A draft was five or six model calls in a row: read the draft, then stages and roles, facts and steps in separate calls, then a reply.
- Claude often sent `propose_split`'s list of processes as a JSON string, which was refused and asked for again.
- Nothing was streamed, so nothing showed until the turn was over.
The workbook itself was not the cost: the sample is about 1,300 tokens, and the prompt was already cached.

## Decision
- **Claude by default when its key is set.** With `CASEBOOK_WIZARD_MODEL` unset, the wizard runs on `anthropic:claude-sonnet-5` when `ANTHROPIC_API_KEY` is set, else on `ollama:qwen2.5:7b`. A model that is named still wins.
- **Low effort.** Claude runs at the effort `CASEBOOK_WIZARD_EFFORT`, `low` unless set. The sample's drafts kept the same processes and number of operations at `low` as at `high`.
- **Fewer round trips.** Each draft-phase request carries the draft as it stands, so the agent starts proposing without reading it first. A hosted model is asked for a process's whole draft in one `apply_operations` call. A local model is still asked for one kind of node at a time.
- **Only the cells needed.** A small workbook is still shown whole and a large one as its tables with their headers and first rows. Other cells are read with `read_cells`, by range and several ranges in one call, in place of the harness's `read_file` over a copy of the whole workbook.
- **Shown as it works.** The model's output is streamed, and Claude's tool inputs are streamed as they are written. While a turn runs, the panel shows what the assistant is doing ("Reading the Claims sheet", "Proposing 3 processes", "Checking 26 proposed changes"), its words, and the processes or nodes it proposes, read from tool calls that are still being written. The panel reads this every 600 ms.
- **Tool calls taken as meant.** A list sent as a JSON string is read as the list. A streamed tool input with a little stray text after its complete JSON is read as that JSON; the provider does not check streamed input, and Claude sometimes ends one with `</invoke>`. The tool then checks the input exactly as before. Nothing else about what is accepted changes.

## Consequences
- On the sample, Claude's split appears in 6 to 8 seconds, with its first words within 2 and its first process within about 3. Drafting the first process takes about 30 seconds, with its nodes listed as they are written.
- The one-at-a-time queue, lenient reading and the timeout still apply to Ollama as before.
- Claude's effort can be raised for a hard workbook at the cost of time.
- The live view is read from this server process, as the turn's progress already was, so it needs the request to reach the process running the turn.
