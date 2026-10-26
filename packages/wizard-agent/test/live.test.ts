// Runs the wizard on the configured model (CASEBOOK_WIZARD_MODEL, a local Ollama unless set), so it is
// slow and, on a hosted provider, costs money.
// Skipped unless CASEBOOK_LIVE_AGENT is set:
// `CASEBOOK_LIVE_AGENT=1 pnpm --filter @casebook/wizard-agent test`.
import { describe, expect, it } from 'vitest';
import { readWorkbook } from '@casebook/sheet-import';
import {
	createChatModel,
	memoryDrafts,
	pendingTurn,
	sampleWorkbook,
	SAMPLE_FILE_NAME,
	sourceProblem,
	startState,
	wizard
} from '../src/index.js';

describe.skipIf(!process.env.CASEBOOK_LIVE_AGENT)('the wizard on a real model (live)', () => {
	it(
		'splits the sample tracker and drafts its first process with linked cells',
		{ timeout: 600_000 },
		async () => {
			const workbook = readWorkbook(sampleWorkbook());
			const drafts = memoryDrafts();
			const ctx = { model: createChatModel(), drafts, workbook };

			let state = await wizard.proposeSplit(ctx, startState(SAMPLE_FILE_NAME));
			expect(state.split?.processes.length).toBeGreaterThan(0);

			state = await wizard.acceptSplit(drafts, state, 'ns-live');
			state = await wizard.draft(ctx, state, state.activeKey!);
			const turn = pendingTurn(state, state.activeKey!);
			expect(turn?.ops.length).toBeGreaterThan(0);
			for (const op of turn!.ops) {
				if (op.op === 'add_node') {
					expect(
						sourceProblem(workbook, SAMPLE_FILE_NAME, op.node.core.source),
						op.node.core.id
					).toBeUndefined();
				}
			}
			state = await wizard.acceptTurn(drafts, state, turn!.id, 1);
			expect(state.processes[0]!.drafted).toBe(true);
		}
	);
});
