import { describe, expect, it } from 'vitest';
import schema from '../schema/process-definition.schema.json' with { type: 'json' };
import { NODE_KINDS, type Node } from '../src/index.js';

describe('model placeholder', () => {
	it('lists the node kinds from ADR 0003', () => {
		expect(NODE_KINDS).toEqual([
			'process',
			'stage',
			'step',
			'fact',
			'role',
			'decision',
			'approval'
		]);
	});

	it('accepts a step node shaped like ADR 0003', () => {
		const node: Node = {
			core: {
				id: 'step.form-working-group',
				kind: 'step',
				actor: 'either',
				guards: [{ text: 'Only for SEV1 or SEV2 incidents' }]
			},
			data: { 'ui.icon': 'users' }
		};
		expect(node.core.kind).toBe('step');
	});

	it('ships a JSON Schema 2020-12 process-definition schema', () => {
		expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
	});
});
