import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import {
	OPERATION_NAMES,
	OPERATION_SCHEMAS,
	checkOperation,
	type Operation,
	type OperationName
} from '../../src/index.js';

const examples: Record<OperationName, Operation> = {
	add_node: {
		op: 'add_node',
		node: { core: { id: 'stage.mitigate', kind: 'stage', title: 'Mitigate' } }
	},
	remove_node: { op: 'remove_node', id: 'step.notify-downstream' },
	update_core: { op: 'update_core', id: 'stage.detect', changes: { title: 'Triage' } },
	set_content: { op: 'set_content', id: 'stage.detect', content: null },
	set_data: { op: 'set_data', id: 'stage.detect', key: 'ui.icon', value: 'radar' },
	link: {
		op: 'link',
		from: 'step.resolve-incident',
		edge: 'collects',
		to: 'fact.status-update',
		by: 'role.communications-lead'
	},
	unlink: { op: 'unlink', from: 'step.write-rca', edge: 'approval', to: 'approval.rca-sign-off' },
	move_to_stage: { op: 'move_to_stage', id: 'step.write-rca', stage: 'stage.resolve' },
	move_stage: { op: 'move_stage', id: 'stage.review', before: 'stage.respond' }
};

describe('operation schemas', () => {
	const ajv = new Ajv2020({ strictTypes: false });

	it('has a schema for every operation', () => {
		expect(Object.keys(OPERATION_SCHEMAS).sort()).toEqual([...OPERATION_NAMES].sort());
	});

	it.each(OPERATION_NAMES)(
		'%s: is a self-contained JSON Schema accepting a valid example',
		(name) => {
			const schema = OPERATION_SCHEMAS[name];
			expect(schema).toMatchObject({
				title: name,
				type: 'object',
				description: expect.any(String)
			});
			const validator = ajv.compile(schema);
			expect(validator(examples[name])).toBe(true);
			expect(validator({ ...examples[name], op: 'something_else' })).toBe(false);
			expect(checkOperation(examples[name])).toEqual({ valid: true, operation: examples[name] });
		}
	);

	it('gives add_node the full node shape, so an agent knows what a node looks like', () => {
		const validator = ajv.compile(OPERATION_SCHEMAS.add_node);
		expect(validator({ op: 'add_node', node: { core: { id: 'step.x', kind: 'step' } } })).toBe(
			false
		);
		expect(OPERATION_SCHEMAS.add_node.$defs).toHaveProperty('stepCore');
		expect(OPERATION_SCHEMAS.remove_node.$defs).toEqual({ nodeId: expect.any(Object) });
	});
});
