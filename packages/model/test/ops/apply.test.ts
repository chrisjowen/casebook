import { describe, expect, it } from 'vitest';
import { birthRegistrationAbroad, incidentManagement } from '../../fixtures/index.js';
import {
	apply,
	applyBatch,
	checkDraft,
	validate,
	type ApplyResult,
	type DefinitionDocument,
	type Node,
	type Operation,
	type StepCore
} from '../../src/index.js';
import { clone, deepFreeze } from '../../src/ops/json.js';

// Frozen copies: any attempt to modify the input throws, and the originals stay untouched.
const incident = deepFreeze(clone(incidentManagement));
const birth = deepFreeze(clone(birthRegistrationAbroad));

function applied(result: ApplyResult): DefinitionDocument {
	if (!result.ok) throw new Error(`expected the operation to apply: ${result.reason}`);
	expect(validate(result.document).valid).toBe(true);
	return result.document;
}

function nodeOf(document: DefinitionDocument, id: string): Node | undefined {
	return document.nodes.find((n) => n.core.id === id);
}

function stepCore(document: DefinitionDocument, id: string): StepCore {
	const node = nodeOf(document, id);
	if (node?.core.kind !== 'step') throw new Error(`${id} is not a step`);
	return node.core;
}

const escalate: Node = {
	core: {
		id: 'step.escalate',
		kind: 'step',
		title: 'Escalate to leadership',
		stage: 'stage.respond',
		role: 'role.incident-commander',
		actor: 'human',
		requires: ['fact.severity']
	}
};

describe('add_node', () => {
	it('adds a node after the last node of its kind and leaves the input alone', () => {
		const document = applied(apply(incident, { op: 'add_node', node: escalate }));
		expect(nodeOf(document, 'step.escalate')).toEqual(escalate);
		expect(document.nodes).toHaveLength(incident.nodes.length + 1);
		const lastStep = incident.nodes.findLastIndex((n) => n.core.kind === 'step');
		expect(document.nodes[lastStep + 1]?.core.id).toBe('step.escalate');
		expect(incident).toEqual(incidentManagement);
	});

	it('appends a node of a kind the document does not have yet', () => {
		const document = applied(
			apply(birth, {
				op: 'add_node',
				node: {
					core: {
						id: 'approval.extra-check',
						kind: 'approval',
						role: 'role.parent',
						actor: 'human'
					}
				}
			})
		);
		expect(document.nodes.at(-1)?.core.id).toBe('approval.extra-check');
	});

	it('copies the node, so later changes to the operation do not leak in', () => {
		const node = clone(escalate);
		const document = applied(apply(incident, { op: 'add_node', node }));
		node.core.title = 'Changed afterwards';
		expect(nodeOf(document, 'step.escalate')?.core.title).toBe('Escalate to leadership');
	});

	it('rejects an id that already exists', () => {
		expect(
			apply(incident, { op: 'add_node', node: { core: { id: 'stage.detect', kind: 'stage' } } })
		).toMatchObject({
			ok: false,
			code: 'duplicate-id',
			reason: 'stage.detect already exists; choose a new id or change the existing node'
		});
	});

	it('rejects a node that does not match the schema, naming the field', () => {
		const result = apply(incident, {
			op: 'add_node',
			node: {
				core: { id: 'step.bad', kind: 'step', stage: 'stage.detect', role: 'role.service-owner' }
			}
		} as unknown as Operation);
		expect(result).toMatchObject({
			ok: false,
			code: 'schema-violation',
			reason: 'step.bad: core is missing required field "actor"'
		});
		expect(result.ok || result.errors).toEqual([
			expect.objectContaining({ nodeId: 'step.bad', field: 'core', keyword: 'required' })
		]);
	});

	it('rejects a node that refers to a stage, fact or approval that does not exist', () => {
		const result = apply(incident, {
			op: 'add_node',
			node: {
				core: { ...escalate.core, id: 'step.escalate', stage: 'stage.nowhere' } as StepCore
			}
		});
		expect(result).toMatchObject({
			ok: false,
			code: 'broken-reference',
			reason: 'step.escalate core.stage refers to stage.nowhere, which is not declared',
			issues: [expect.objectContaining({ code: 'unknown-stage', nodeId: 'step.escalate' })]
		});
	});

	it('accepts an undeclared role, as a warning that blocks publishing', () => {
		const result = apply(birth, {
			op: 'add_node',
			node: {
				core: {
					id: 'step.notify-relatives',
					kind: 'step',
					stage: 'stage.consular-registration',
					role: 'role.grandparent',
					actor: 'either',
					requires: ['fact.consular-reference']
				}
			}
		});
		const document = applied(result);
		expect(nodeOf(document, 'step.notify-relatives')).toBeDefined();
		expect(result.ok && result.warnings.map((w) => [w.code, w.severity, w.nodeId])).toEqual([
			['undeclared-role', 'error', 'step.notify-relatives']
		]);
	});

	it('rejects a second process node', () => {
		expect(
			apply(incident, {
				op: 'add_node',
				node: { core: { id: 'process.another', kind: 'process' } }
			})
		).toMatchObject({ ok: false, code: 'process-count' });
	});
});

describe('remove_node', () => {
	it('removes a node nothing refers to', () => {
		const document = applied(apply(incident, { op: 'remove_node', id: 'step.notify-downstream' }));
		expect(nodeOf(document, 'step.notify-downstream')).toBeUndefined();
		expect(document.nodes).toHaveLength(incident.nodes.length - 1);
	});

	it('refuses while other nodes refer to it, listing each reference', () => {
		expect(apply(incident, { op: 'remove_node', id: 'fact.severity' })).toMatchObject({
			ok: false,
			code: 'referenced',
			reason:
				'fact.severity cannot be removed while other nodes refer to it: ' +
				'decision.classify-severity (core.outcome); ' +
				'step.form-working-group (core.requires[0], core.when.expr); ' +
				'step.post-status-update (core.requires[0]); ' +
				'step.resolve-incident (core.requires[0]); ' +
				'step.write-rca (core.requires[0]). Change or unlink those references first'
		});
	});

	it('refuses to remove a role in use, even though an undeclared role is only a warning', () => {
		expect(apply(birth, { op: 'remove_node', id: 'role.translator' })).toMatchObject({
			ok: false,
			code: 'referenced'
		});
	});

	it('refuses to remove the process node', () => {
		expect(apply(incident, { op: 'remove_node', id: 'process.incident-management' })).toMatchObject(
			{
				ok: false,
				code: 'process-count',
				reason: 'the definition has no process node; add exactly one'
			}
		);
	});

	it('rejects an unknown node', () => {
		expect(apply(incident, { op: 'remove_node', id: 'step.nope' })).toMatchObject({
			ok: false,
			code: 'unknown-node',
			reason: 'step.nope does not exist in this definition'
		});
	});
});

describe('update_core', () => {
	it('merges changes into the core and removes fields set to null', () => {
		const document = applied(
			apply(incident, {
				op: 'update_core',
				id: 'step.form-working-group',
				changes: { title: 'Form a working group', when: null, actor: 'human' }
			})
		);
		const core = stepCore(document, 'step.form-working-group');
		expect(core.title).toBe('Form a working group');
		expect(core.actor).toBe('human');
		expect(core).not.toHaveProperty('when');
		expect(core.collects).toEqual(stepCore(incident, 'step.form-working-group').collects);
	});

	it('merges nested objects and replaces arrays', () => {
		const document = applied(
			apply(incident, {
				op: 'update_core',
				id: 'step.post-status-update',
				changes: {
					repeat: { every: 'PT1H' },
					requires: ['fact.severity', 'fact.affected-services']
				}
			})
		);
		const core = stepCore(document, 'step.post-status-update');
		expect(core.repeat).toEqual({
			until: { text: 'Until the incident is resolved', expr: 'fact.resolved-at != null' },
			every: 'PT1H'
		});
		expect(core.requires).toEqual(['fact.severity', 'fact.affected-services']);
	});

	it('rejects a change that breaks the schema', () => {
		expect(
			apply(incident, { op: 'update_core', id: 'step.write-rca', changes: { actor: 'robot' } })
		).toMatchObject({
			ok: false,
			code: 'schema-violation',
			reason: 'step.write-rca: core.actor must be one of "human", "agent" or "either"'
		});
	});

	it('rejects removing a required field', () => {
		expect(
			apply(incident, { op: 'update_core', id: 'step.write-rca', changes: { stage: null } })
		).toMatchObject({ ok: false, code: 'schema-violation' });
	});

	it('rejects a change to the id or kind', () => {
		expect(
			apply(incident, { op: 'update_core', id: 'stage.detect', changes: { id: 'stage.spot' } })
		).toMatchObject({
			ok: false,
			code: 'immutable-field',
			reason: 'stage.detect: id cannot be changed; add a new node and remove this one instead'
		});
	});

	it('rejects a broken reference but accepts a guard naming an unknown fact, as a warning', () => {
		expect(
			apply(incident, {
				op: 'update_core',
				id: 'step.write-rca',
				changes: { approval: 'approval.nope' }
			})
		).toMatchObject({ ok: false, code: 'broken-reference' });

		const result = apply(incident, {
			op: 'update_core',
			id: 'step.write-rca',
			changes: {
				when: { text: 'Only for customer-facing incidents', expr: 'fact.customer-facing' }
			}
		});
		applied(result);
		expect(result.ok && result.warnings.map((w) => w.code)).toEqual(['unknown-guard-fact']);
	});
});

describe('set_content', () => {
	it('sets, replaces and removes content', () => {
		const set = applied(
			apply(incident, { op: 'set_content', id: 'stage.detect', content: 'Spot it.' })
		);
		expect(nodeOf(set, 'stage.detect')?.content).toBe('Spot it.');
		const removed = applied(apply(set, { op: 'set_content', id: 'stage.detect', content: null }));
		expect(nodeOf(removed, 'stage.detect')).toEqual({
			core: nodeOf(incident, 'stage.detect')?.core
		});
		const emptied = applied(apply(set, { op: 'set_content', id: 'stage.detect', content: '' }));
		expect(nodeOf(emptied, 'stage.detect')).not.toHaveProperty('content');
	});

	it('rejects an unknown node', () => {
		expect(apply(incident, { op: 'set_content', id: 'stage.nope', content: 'x' })).toMatchObject({
			ok: false,
			code: 'unknown-node'
		});
	});
});

describe('set_data', () => {
	it('sets a namespaced key, replacing any value whole', () => {
		const document = applied(
			apply(incident, {
				op: 'set_data',
				id: 'step.form-working-group',
				key: 'hooks.on_completed',
				value: ['page-leadership']
			})
		);
		expect(nodeOf(document, 'step.form-working-group')?.data).toEqual({
			'ui.icon': 'users',
			'hooks.on_completed': ['page-leadership']
		});
		const layout = applied(
			apply(incident, {
				op: 'set_data',
				id: 'stage.detect',
				key: 'ui.layout',
				value: { x: 1, y: 2 }
			})
		);
		const moved = applied(
			apply(layout, { op: 'set_data', id: 'stage.detect', key: 'ui.layout', value: { x: 5 } })
		);
		expect(nodeOf(moved, 'stage.detect')?.data).toEqual({ 'ui.layout': { x: 5 } });
	});

	it('removes a key set to null, and the data map once it is empty', () => {
		const document = applied(
			apply(incident, {
				op: 'set_data',
				id: 'step.notify-downstream',
				key: 'hooks.on_completed',
				value: null
			})
		);
		expect(nodeOf(document, 'step.notify-downstream')).not.toHaveProperty('data');
	});

	it('rejects a key without a namespace', () => {
		expect(
			apply(incident, { op: 'set_data', id: 'stage.detect', key: 'icon', value: 'x' })
		).toMatchObject({
			ok: false,
			code: 'invalid-operation',
			reason:
				'The operation is malformed: key must be a namespaced key, such as "ui.icon" or "hooks.on_completed"'
		});
	});
});

describe('link and unlink', () => {
	it('links and unlinks a required fact', () => {
		const linked = applied(
			apply(incident, {
				op: 'link',
				from: 'step.resolve-incident',
				edge: 'requires',
				to: 'fact.affected-services'
			})
		);
		expect(stepCore(linked, 'step.resolve-incident').requires).toEqual([
			'fact.severity',
			'fact.affected-services'
		]);
		const unlinked = applied(
			apply(linked, {
				op: 'unlink',
				from: 'step.resolve-incident',
				edge: 'requires',
				to: 'fact.severity'
			})
		);
		expect(stepCore(unlinked, 'step.resolve-incident').requires).toEqual([
			'fact.affected-services'
		]);
		const none = applied(
			apply(unlinked, {
				op: 'unlink',
				from: 'step.resolve-incident',
				edge: 'requires',
				to: 'fact.affected-services'
			})
		);
		expect(stepCore(none, 'step.resolve-incident')).not.toHaveProperty('requires');
	});

	it('links a collected fact with the role that records it, and unlinks it with a warning', () => {
		const document = applied(
			apply(incident, {
				op: 'link',
				from: 'step.resolve-incident',
				edge: 'collects',
				to: 'fact.status-update',
				by: 'role.communications-lead'
			})
		);
		expect(stepCore(document, 'step.resolve-incident').collects).toContainEqual({
			fact: 'fact.status-update',
			by: 'role.communications-lead'
		});

		const result = apply(incident, {
			op: 'unlink',
			from: 'step.report-incident',
			edge: 'collects',
			to: 'fact.incident-summary'
		});
		applied(result);
		expect(result.ok && result.warnings).toEqual([
			expect.objectContaining({
				code: 'uncollected-fact',
				severity: 'error',
				nodeId: 'fact.incident-summary'
			})
		]);
	});

	it('links, replaces and unlinks an approval', () => {
		const added = applied(
			apply(incident, {
				op: 'add_node',
				node: {
					core: {
						id: 'approval.director-ok',
						kind: 'approval',
						role: 'role.engineering-director',
						actor: 'human'
					}
				}
			})
		);
		const replaced = applied(
			apply(added, {
				op: 'link',
				from: 'step.write-rca',
				edge: 'approval',
				to: 'approval.director-ok'
			})
		);
		expect(stepCore(replaced, 'step.write-rca').approval).toBe('approval.director-ok');
		const unlinked = applied(
			apply(replaced, {
				op: 'unlink',
				from: 'step.write-rca',
				edge: 'approval',
				to: 'approval.director-ok'
			})
		);
		expect(stepCore(unlinked, 'step.write-rca')).not.toHaveProperty('approval');
	});

	it('links a stage, which moves the step', () => {
		const document = applied(
			apply(incident, { op: 'link', from: 'step.write-rca', edge: 'stage', to: 'stage.resolve' })
		);
		expect(stepCore(document, 'step.write-rca').stage).toBe('stage.resolve');
	});

	it.each<[string, Operation, string, string]>([
		[
			'an unknown target',
			{ op: 'link', from: 'step.write-rca', edge: 'requires', to: 'fact.nope' },
			'unknown-node',
			'fact.nope does not exist in this definition'
		],
		[
			'a target of the wrong kind',
			{ op: 'link', from: 'step.write-rca', edge: 'requires', to: 'role.service-owner' },
			'wrong-kind',
			'Cannot link step.write-rca requires to role.service-owner: a requires edge must point to a fact'
		],
		[
			'an edge the source kind does not have',
			{ op: 'link', from: 'decision.classify-severity', edge: 'collects', to: 'fact.severity' },
			'wrong-kind',
			'Cannot link collects on decision.classify-severity: only a step has collects edges'
		],
		[
			'an edge that already exists',
			{ op: 'link', from: 'step.write-rca', edge: 'requires', to: 'fact.severity' },
			'no-change',
			'step.write-rca already has requires fact.severity'
		],
		[
			'"by" on an edge other than collects',
			{
				op: 'link',
				from: 'step.write-rca',
				edge: 'requires',
				to: 'fact.resolved-at',
				by: 'role.service-owner'
			},
			'invalid-operation',
			'"by" applies only to collects edges, not requires'
		],
		[
			'an unknown edge kind',
			{
				op: 'link',
				from: 'step.write-rca',
				edge: 'blocks',
				to: 'fact.severity'
			} as unknown as Operation,
			'invalid-operation',
			'The operation is malformed: edge must be one of "requires", "collects", "approval", "stage"'
		],
		[
			'unlinking an edge that does not exist',
			{ op: 'unlink', from: 'step.write-rca', edge: 'requires', to: 'fact.resolved-at' },
			'not-linked',
			'step.write-rca has no requires edge to fact.resolved-at'
		],
		[
			'unlinking a stage',
			{ op: 'unlink', from: 'step.write-rca', edge: 'stage', to: 'stage.review' },
			'required-edge',
			'step.write-rca must belong to a stage; use move_to_stage to change it'
		]
	])('rejects %s', (_name, operation, code, reason) => {
		expect(apply(incident, operation)).toMatchObject({ ok: false, code, reason });
	});
});

describe('move_to_stage', () => {
	it('moves a step or decision to another stage', () => {
		const document = applied(
			apply(incident, {
				op: 'move_to_stage',
				id: 'decision.classify-severity',
				stage: 'stage.respond'
			})
		);
		const node = nodeOf(document, 'decision.classify-severity');
		expect(node?.core.kind === 'decision' && node.core.stage).toBe('stage.respond');
	});

	it('warns when the move leaves a stage empty', () => {
		const result = apply(incident, {
			op: 'move_to_stage',
			id: 'step.resolve-incident',
			stage: 'stage.review'
		});
		applied(result);
		expect(result.ok && result.warnings).toEqual([
			expect.objectContaining({ code: 'empty-stage', severity: 'warning', nodeId: 'stage.resolve' })
		]);
	});

	it.each<[string, Operation, string]>([
		[
			'an unknown stage',
			{ op: 'move_to_stage', id: 'step.write-rca', stage: 'stage.nope' },
			'unknown-node'
		],
		[
			'a node that is not a stage',
			{ op: 'move_to_stage', id: 'step.write-rca', stage: 'fact.severity' } as unknown as Operation,
			'invalid-operation'
		],
		[
			'a node that has no stage',
			{
				op: 'move_to_stage',
				id: 'approval.rca-sign-off',
				stage: 'stage.review'
			} as unknown as Operation,
			'invalid-operation'
		],
		[
			'the stage it is already in',
			{ op: 'move_to_stage', id: 'step.write-rca', stage: 'stage.review' },
			'no-change'
		]
	])('rejects %s', (_name, operation, code) => {
		expect(apply(incident, operation)).toMatchObject({ ok: false, code });
	});
});

describe('operation shape', () => {
	it.each([
		[
			{ op: 'rename_node', id: 'stage.detect' },
			'op must be one of add_node, remove_node, update_core, set_content, set_data, link, unlink, move_to_stage, move_stage'
		],
		[{ op: 'remove_node' }, 'operation is missing required field "id"'],
		[{ op: 'remove_node', id: 'stage.detect', extra: true }, 'operation has unknown field "extra"'],
		[
			{ op: 'remove_node', id: 'Detect' },
			'id must be a node id: its kind, a dot, then lowercase words joined by hyphens, such as "step.notify-downstream"'
		],
		[
			{ op: 'update_core', id: 'stage.detect', changes: {} },
			'changes must list at least one field to change'
		]
	])('rejects a malformed operation %j', (operation, message) => {
		expect(apply(incident, operation as unknown as Operation)).toMatchObject({
			ok: false,
			code: 'invalid-operation',
			reason: `The operation is malformed: ${message}`
		});
	});
});

describe('applyBatch', () => {
	const turn: Operation[] = [
		{
			op: 'add_node',
			node: { core: { id: 'fact.leadership-paged', kind: 'fact', schema: { type: 'boolean' } } }
		},
		{ op: 'add_node', node: escalate },
		{ op: 'link', from: 'step.escalate', edge: 'collects', to: 'fact.leadership-paged' }
	];

	it('applies every operation in order, each against the result of the last', () => {
		const result = applyBatch(incident, turn);
		const document = applied(result);
		expect(stepCore(document, 'step.escalate').collects).toEqual([
			{ fact: 'fact.leadership-paged' }
		]);
		expect(result.ok && result.warnings).toEqual([]);
	});

	it('rejects the whole batch when one operation fails, naming it', () => {
		const failing: Operation = {
			op: 'link',
			from: 'step.escalate',
			edge: 'requires',
			to: 'fact.nope'
		};
		const result = applyBatch(incident, [...turn, failing]);
		expect(result).toMatchObject({ ok: false, code: 'unknown-node', index: 3, operation: failing });
		expect(incident).toEqual(incidentManagement);
	});

	it('reports warnings for the final document only', () => {
		const partial = applyBatch(incident, turn.slice(0, 1));
		expect(partial.ok && partial.warnings.map((w) => w.code)).toEqual(['unused-fact']);
	});

	it('returns the document unchanged for an empty batch', () => {
		expect(applyBatch(incident, [])).toEqual({ ok: true, document: incident, warnings: [] });
	});

	it('lets a later operation repair what an earlier one left incomplete', () => {
		const result = applyBatch(birth, [
			{
				op: 'unlink',
				from: 'step.complete-application',
				edge: 'collects',
				to: 'fact.application-form'
			},
			{ op: 'link', from: 'step.book-appointment', edge: 'collects', to: 'fact.application-form' }
		]);
		expect(result.ok).toBe(true);
	});
});

describe('move_stage', () => {
	const stages = (document: DefinitionDocument) =>
		document.nodes.filter((n) => n.core.kind === 'stage').map((n) => n.core.id);

	it('moves a stage just before another, leaving every other node in place', () => {
		const document = applied(
			apply(incident, { op: 'move_stage', id: 'stage.review', before: 'stage.respond' })
		);
		expect(stages(document)).toEqual([
			'stage.detect',
			'stage.review',
			'stage.respond',
			'stage.resolve'
		]);
		const others = (d: DefinitionDocument) => d.nodes.filter((n) => n.core.kind !== 'stage');
		expect(others(document)).toEqual(others(incident));
	});

	it('moves a stage to the end when before is null', () => {
		const document = applied(
			apply(incident, { op: 'move_stage', id: 'stage.detect', before: null })
		);
		expect(stages(document)).toEqual([
			'stage.respond',
			'stage.resolve',
			'stage.review',
			'stage.detect'
		]);
	});

	it.each<[string, Operation, string]>([
		[
			'a move that changes nothing',
			{ op: 'move_stage', id: 'stage.detect', before: 'stage.respond' },
			'no-change'
		],
		[
			'moving the last stage last',
			{ op: 'move_stage', id: 'stage.review', before: null },
			'no-change'
		],
		['an unknown stage', { op: 'move_stage', id: 'stage.nope', before: null }, 'unknown-node'],
		[
			'moving before a step',
			{ op: 'move_stage', id: 'stage.review', before: 'step.write-rca' as never },
			'invalid-operation'
		],
		[
			'moving before itself',
			{ op: 'move_stage', id: 'stage.review', before: 'stage.review' },
			'invalid-operation'
		]
	])('rejects %s', (_name, operation, code) => {
		expect(apply(incident, operation)).toMatchObject({ ok: false, code });
	});
});

describe('checkDraft', () => {
	it('accepts the fixtures and rejects a document with a broken reference', () => {
		expect(checkDraft(incident)).toEqual({ ok: true, document: incident, warnings: [] });
		const broken = {
			...birth,
			nodes: birth.nodes.filter((n) => n.core.id !== 'stage.local-registration')
		};
		expect(checkDraft(broken)).toMatchObject({ ok: false, code: 'broken-reference' });
	});
});
