import { describe, expect, it } from 'vitest';
import { readWorkbook } from '@casebook/sheet-import';
import { OPERATION_NAMES } from '@casebook/model';
import {
	completeSource,
	formatRange,
	operationsSchema,
	parseModel,
	parseRanges,
	plainRange,
	sampleWorkbook,
	SAMPLE_FILE_NAME,
	sourceProblem,
	tidyOperation,
	operationsInText,
	wizard
} from '../src/index.js';

const workbook = readWorkbook(sampleWorkbook());

describe('cell references', () => {
	it('quotes sheet names that need it and reads them back', () => {
		const ranges = [
			{ sheet: 'Birth reg', range: '$a$2:g7' },
			{ sheet: 'Claims', range: 'B4' },
			{ sheet: "Bob's", range: 'A1' }
		];
		const ref = ranges.map(formatRange).join(', ');
		expect(ref).toBe("'Birth reg'!A2:G7, Claims!B4, 'Bob''s'!A1");
		expect(parseRanges(ref)).toEqual([
			{ sheet: 'Birth reg', range: 'A2:G7' },
			{ sheet: 'Claims', range: 'B4' },
			{ sheet: "Bob's", range: 'A1' }
		]);
		expect(parseRanges('Claims!B4, nonsense')).toEqual([]);
	});

	it('accepts a range written with its sheet, as small models write it', () => {
		expect(plainRange({ sheet: 'Birth reg', range: 'Birth reg!A2:G7' })).toEqual({
			sheet: 'Birth reg',
			range: 'A2:G7'
		});
		expect(plainRange({ sheet: 'Claims', range: 'b2:f8' })).toEqual({
			sheet: 'Claims',
			range: 'B2:F8'
		});
	});

	it('completes a node’s source and explains what cannot be completed', () => {
		expect(completeSource({ ref: 'A3:F3' }, SAMPLE_FILE_NAME, 'Birth reg')).toEqual({
			doc: SAMPLE_FILE_NAME,
			ref: "'Birth reg'!A3:F3",
			inferred: false
		});
		const ok = completeSource({ doc: 'tracker', ref: "'Birth reg'!A3" }, SAMPLE_FILE_NAME);
		expect(sourceProblem(workbook, SAMPLE_FILE_NAME, ok)).toBeUndefined();
		expect(sourceProblem(workbook, SAMPLE_FILE_NAME, undefined)).toMatch(/has no core.source/);
		expect(
			sourceProblem(workbook, SAMPLE_FILE_NAME, { doc: SAMPLE_FILE_NAME, ref: 'Claims!Z90' })
		).toMatch(/outside the cells "Claims" uses \(A1:F8\)/);
		expect(
			sourceProblem(workbook, SAMPLE_FILE_NAME, { doc: SAMPLE_FILE_NAME, ref: 'Nope!A1' })
		).toMatch(/there is no sheet "Nope"/);
	});
});

describe('the split request', () => {
	it('lists every table with its cells and header', () => {
		expect(wizard.sheetOverview(workbook).split('\n')).toEqual([
			'- "Birth reg" A2:G7: Step, Who, When, Needs, Records, Notes, Target date (5 rows)',
			'- "Passport & ID" A2:F4: Step, Who, When, Needs, Records, Notes (2 rows)',
			'- "Citizenship" A2:F7: Step, Who, When, Needs, Records, Notes (5 rows)',
			'- "Claims" A2:F8: Step, Who, When, Needs, Records, Notes (6 rows)',
			'- "Documents" A2:D6: Document, Format, Copies, Used for (4 rows)'
		]);
	});
});

describe('operations as models write them', () => {
	it('drops fields an operation does not define', () => {
		expect(
			tidyOperation({ op: 'add_node', changes: {}, node: { core: { id: 'stage.a' } } })
		).toEqual({ op: 'add_node', node: { core: { id: 'stage.a' } } });
		expect(tidyOperation({ op: 'unknown', x: 1 })).toEqual({ op: 'unknown', x: 1 });
		expect(
			tidyOperation({ op: 'add_node', node: { id: 'stage.a', kind: 'stage', content: 'x' } })
		).toEqual({ op: 'add_node', node: { core: { id: 'stage.a', kind: 'stage' }, content: 'x' } });
		expect(
			tidyOperation({
				op: 'add_node',
				node: { id: 'stage.a', kind: 'stage', core: { source: { ref: 'Claims!A2' } } }
			})
		).toEqual({
			op: 'add_node',
			node: { core: { id: 'stage.a', kind: 'stage', source: { ref: 'Claims!A2' } } }
		});
		expect(
			tidyOperation({ op: 'add_node', node: { core: { id: 'step.a', kind: 'step' } } })
		).toEqual({ op: 'add_node', node: { core: { id: 'step.a', kind: 'step' } } });
		expect(
			tidyOperation({
				op: 'add_node',
				node: {
					core: {
						id: 'step.a',
						kind: 'step',
						actor: { kind: 'role.parent' },
						when: { text: 'Within 7 days', expr: null }
					}
				}
			})
		).toEqual({
			op: 'add_node',
			node: {
				core: {
					id: 'step.a',
					kind: 'step',
					actor: { kind: 'role.parent' },
					when: { text: 'Within 7 days' }
				}
			}
		});
	});

	it('reads operations a model wrote into its reply', () => {
		const op = { op: 'add_node', node: { core: { id: 'stage.a' } } };
		expect(operationsInText('Here:\n```json\n[' + JSON.stringify(op) + ']\n```')).toEqual([op]);
		expect(operationsInText(JSON.stringify({ operations: [op] }))).toEqual([op]);
		expect(operationsInText('Stages [first] and {roles}.')).toEqual([]);
		// Trailing commas, a comment, and a reply cut off inside its third operation.
		const loose = `\`\`\`json\n[\n// stages\n${JSON.stringify(op)},\n${JSON.stringify(op)},\n{"op": "add_node", "node": {"co`;
		expect(operationsInText(loose)).toEqual([op, op]);
	});
});

describe('the tool schema the model is shown', () => {
	it('offers every node operation, self-contained', () => {
		const schema = operationsSchema() as {
			properties: { operations: { items: { anyOf: { title: string }[] } } };
			$defs: Record<string, unknown>;
		};
		expect(schema.properties.operations.items.anyOf.map((v) => v.title)).toEqual([
			...OPERATION_NAMES
		]);
		expect(schema.$defs.node).toBeDefined();
		expect(JSON.stringify(schema)).not.toContain('json-schema.org/draft/2020-12/schema"}');
	});
});

describe('the model setting', () => {
	it('reads provider:model, keeping colons in the model name', () => {
		expect(parseModel('ollama:qwen2.5:7b')).toEqual({ provider: 'ollama', model: 'qwen2.5:7b' });
		expect(parseModel('anthropic:claude-sonnet-5')).toEqual({
			provider: 'anthropic',
			model: 'claude-sonnet-5'
		});
		expect(() => parseModel('claude-sonnet-5')).toThrow(/provider:model/);
		expect(() => parseModel('bedrock:x')).toThrow(/not "bedrock"/);
	});
});
