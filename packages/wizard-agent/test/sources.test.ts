import { afterEach, describe, expect, it } from 'vitest';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { readWorkbook } from '@casebook/sheet-import';
import { OPERATION_NAMES } from '@casebook/model';
import {
	completeSource,
	createChatModel,
	defaultModel,
	formatRange,
	modelName,
	operationsSchema,
	parseModel,
	takesEffort,
	wizardEffort,
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

	const saved = {
		model: process.env.CASEBOOK_WIZARD_MODEL,
		key: process.env.ANTHROPIC_API_KEY,
		effort: process.env.CASEBOOK_WIZARD_EFFORT
	};
	const restore = (name: string, value: string | undefined) =>
		value === undefined ? delete process.env[name] : (process.env[name] = value);
	afterEach(() => {
		restore('CASEBOOK_WIZARD_MODEL', saved.model);
		restore('ANTHROPIC_API_KEY', saved.key);
		restore('CASEBOOK_WIZARD_EFFORT', saved.effort);
	});

	it('defaults to Claude when its key is set and to a local Ollama when not; a named model wins', () => {
		delete process.env.CASEBOOK_WIZARD_MODEL;
		delete process.env.ANTHROPIC_API_KEY;
		expect(defaultModel()).toBe('ollama:qwen2.5:7b');
		expect(modelName()).toBe('ollama:qwen2.5:7b');
		process.env.ANTHROPIC_API_KEY = 'test-key';
		expect(modelName()).toBe('anthropic:claude-sonnet-5');
		process.env.CASEBOOK_WIZARD_MODEL = 'ollama:llama3.1:8b';
		expect(modelName()).toBe('ollama:llama3.1:8b');
	});

	it('runs Claude at a low effort unless told otherwise, on models that take one', () => {
		delete process.env.CASEBOOK_WIZARD_EFFORT;
		expect(wizardEffort()).toBe('low');
		process.env.CASEBOOK_WIZARD_EFFORT = 'Medium';
		expect(wizardEffort()).toBe('medium');
		process.env.CASEBOOK_WIZARD_EFFORT = 'fast';
		expect(() => wizardEffort()).toThrow(/low, medium, high, xhigh, max/);
		expect(takesEffort('claude-sonnet-5')).toBe(true);
		expect(takesEffort('claude-opus-4-6')).toBe(true);
		expect(takesEffort('claude-sonnet-4-5')).toBe(false);
		expect(takesEffort('claude-sonnet-4-20250514')).toBe(false);
		expect(takesEffort('claude-haiku-4-5')).toBe(false);
	});

	it('starts Claude with its effort, streaming the input of tools marked for it', () => {
		process.env.ANTHROPIC_API_KEY = 'test-key';
		delete process.env.CASEBOOK_WIZARD_EFFORT;
		const claude = createChatModel('anthropic:claude-sonnet-5') as unknown as {
			outputConfig?: { effort?: string };
			formatStructuredToolToAnthropic: (tools: unknown[]) => Record<string, unknown>[];
		};
		expect(claude.outputConfig).toEqual({ effort: 'low' });
		const echo = tool(async () => 'ok', {
			name: 'echo',
			description: 'Echoes',
			schema: z.object({ text: z.string() })
		});
		const long = tool(async () => 'ok', {
			name: 'long',
			description: 'Takes a long input',
			schema: z.object({ text: z.string() }),
			metadata: { streamInput: true }
		});
		const [plain, streamed] = claude.formatStructuredToolToAnthropic([echo, long]);
		expect(plain).toMatchObject({ name: 'echo' });
		expect(plain).not.toHaveProperty('eager_input_streaming');
		expect(streamed).toMatchObject({ name: 'long', eager_input_streaming: true });
		const haiku = createChatModel('anthropic:claude-haiku-4-5') as unknown as {
			outputConfig?: unknown;
		};
		expect(haiku.outputConfig).toBeUndefined();
	});
});
