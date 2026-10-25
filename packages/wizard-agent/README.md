# @casebook/wizard-agent

The spreadsheet wizard ([ADR 0011](../../docs/decisions/0011-v1-wizard.md), [ADR 0024](../../docs/decisions/0024-the-wizard-on-the-board.md)): an authoring agent built on [`deepagents`](https://www.npmjs.com/package/deepagents) that turns a workbook read by [`@casebook/sheet-import`](../sheet-import/README.md) into draft process definitions, with a person accepting or rejecting each step.

## How it works

- `state.ts`: the wizard's state for one import, as plain JSON: the split proposal and the person's renames, merges and splits, the processes it created, the chat, and each agent turn as a proposal (`pending`, then `accepted`, `rejected` or `revised`).
- `wizard.ts`: the steps the web app calls. `proposeSplit`, `reply` and `draft` run the agent; `acceptSplit` creates the processes; `acceptTurn` saves a proposal as one edit and `rejectTurn` drops it.
- `agent.ts`: the agent. The workbook is in the conversation and in the agent's virtual filesystem (`/workbook.md`). In the split phase its one tool is `propose_split`; in the draft phase, `read_draft` and `apply_operations`, which take the model's node operations (their JSON Schemas are the tool's input schema). Each `apply_operations` call is previewed, not saved, through `DraftAccess`, so it is checked by the same layer as the editor's edits, and the turn's operations are collected into one proposal.
- `drafts.ts`: `DraftAccess`. `storeDrafts(db, actor)` goes through `@casebook/store`'s definition service as the signed-in person; `memoryDrafts()` keeps drafts in memory with the same model checks, for tests.
- `sources.ts`: cell references. Every node the agent adds must carry `core.source` with cells of the uploaded workbook, such as `'Birth reg'!A4:F4`.
- `model.ts`: the chat model, from `CASEBOOK_WIZARD_MODEL` as `provider:model` (`ollama:qwen2.5:7b` by default; `anthropic:…` and `openai:…` also work).
- `sample.ts`: a synthetic newborn tracker, built in memory as `.xlsx` bytes ([ADR 0014](../../docs/decisions/0014-synthetic-sample-data.md)).

Small local models get help: the agent sees only its own tools and instructions, a model that repeats a refused call is told to stop and explain, and a turn that runs out of steps ends with what it already proposed. With `lenient` (set for Ollama), operations a model writes into its reply instead of calling `apply_operations` are read and checked the same way, and operations written slightly wrong (stray fields, core fields beside the core, a source without its document or sheet) are tidied before they are checked; who may do a step is never filled in or guessed, so a step without an actor is refused. Hosted models' operations are taken only from `apply_operations`, checked as sent.

## Tests

`moon run wizard-agent:test`. A scripted chat model (`test/fake-model.ts`) drives the agent through the split, merge, rename and split-off flow, drafting, refusals, push-back and accept or reject. The store-backed tests need Postgres, like `@casebook/store`'s. `CASEBOOK_LIVE_AGENT=1` also runs `test/live.test.ts` against the configured model.
