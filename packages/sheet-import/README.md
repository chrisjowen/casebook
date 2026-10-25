# @casebook/sheet-import

Reads an `.xlsx` workbook into a neutral, JSON-serializable model the [wizard agent](../wizard-agent/README.md) can work from, and renders it as compact addressed text for an LLM.
Every sheet, region, row, merged range and cell carries a source reference (sheet name plus A1 address or range), so drafted nodes can link back to their source cells ([ADR 0011](../../docs/decisions/0011-v1-wizard.md)).

It is a pure library: it takes bytes and does no I/O. Inferring processes, the agent itself, and any upload UI or endpoint live elsewhere.

## Usage

```ts
import { readWorkbook, renderWorkbookText } from '@casebook/sheet-import';

const workbook = readWorkbook(bytes); // Uint8Array or ArrayBuffer of an .xlsx file
const { text, sheets, omittedSheets } = renderWorkbookText(workbook, { maxTotalChars: 50_000 });
```

## The model

- `Workbook` → `sheets`, plus `date1904`.
- `Sheet` → `rows` (non-empty rows only), `merges`, `regions`, `hidden`, `source` (the range that holds content) and `declaredRange` (the dimension the file claims).
- `Cell` → `address`, 1-based `row` and `col`, `raw` (as stored), `value` (typed: `string`, `number`, `boolean`, `date`, `error` or `empty`), `text` (as displayed), and when present `formula`, `numberFormat`, `hyperlink`, `comments` and `merge`.
- `Region` → a rectangular block separated from others by blank rows or blank columns, with a `header` hint (row, labels by column and the reasons it looks like a header) and a `rowLabelColumn` hint.

Some rules worth knowing:

- Dates are zone-less ISO strings (`2024-03-01`, `2024-03-01T09:30:00`, or `09:30:00` for time-only formats), since spreadsheet dates are wall-clock values. A number is a date when its number format is a date format.
- Formula cells keep the formula and the result cached in the file as `value`; nothing is recalculated.
- The used range ignores formatted-but-empty cells, whitespace-only strings and formulas whose cached result is empty, so long empty trailing ranges do not inflate it. A comment or hyperlink on an empty cell does count as content.
- Merged ranges are kept only when their top-left cell has content; the covered cells are empty and left out.
- `readWorkbook` drops cells beyond `maxRows` (default 10000) or `maxCols` (default 500) and reports the count in `Sheet.limits`.
- Header and row-label hints are heuristics for the wizard to weigh, not decisions.

## Text rendering

`renderSheetText` and `renderWorkbookText` produce one line per row, every cell prefixed with its address:

```
=== Sheet "Tasks" · used A1:C3 · 3 rows
merged: A1:C1
region A1:C3 · header row 2: Task, Owner, Due
r1: A1 Newborn checklist [merged A1:C1]
r2: A2 Task | B2 Owner | C2 Due
r3: A3 Register birth | B3 Sam | C3 01/03/2024 [date 2024-03-01]
```

Output is bounded by a per-sheet budget (`maxChars`), a workbook budget (`maxTotalChars`), a per-cell clip (`maxCellChars`) and a per-row cap (`maxCellsPerRow`, for wide timelines).
Whatever is cut is reported both in the text (a closing `[truncated: ...]` or `[omitted sheets: ...]` line) and in the structured `truncation` and `omittedSheets` results, including the range of omitted rows.

## Parser choice: SheetJS Community Edition

We use [SheetJS CE](https://docs.sheetjs.com) 0.20.3, installed from its official distribution at `cdn.sheetjs.com` and pinned in the lockfile with an integrity hash.
The `xlsx` package on the npm registry is stuck at 0.18.5 with known vulnerabilities; SheetJS publishes newer versions only on its own CDN.

Why SheetJS over [ExcelJS](https://github.com/exceljs/exceljs):

- **License:** Apache-2.0, compatible with this project.
- **Maintained:** releases continue on the official distribution, including security fixes; ExcelJS's last release (4.4.0) dates from 2023.
- **Covers what we read:** cached formula results, number formats and formatted text, merged ranges, hyperlinks, cell comments (including threaded comments) and sheet visibility.
- **Dense, sparse reading:** dense mode stores rows as sparse arrays, so a file whose declared dimension runs to row 1,048,576 costs nothing for the empty rows.
- **No dependencies and bundled types,** which keeps the package light if it ever runs in the browser.
- **Fixtures:** the same library writes the synthetic `.xlsx` fixtures the tests build in memory.

## Tests

`pnpm --filter @casebook/sheet-import test` (or `moon run sheet-import:test`).
Fixtures are synthetic workbooks built in memory by [test/fixtures.ts](test/fixtures.ts) and written to real `.xlsx` bytes; no spreadsheet files are committed ([ADR 0014](../../docs/decisions/0014-synthetic-sample-data.md)).
