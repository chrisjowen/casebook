import { describe, expect, it } from 'vitest';
import { incidentManagement } from '../fixtures/index.js';
import { validate, type ValidationError } from '../src/index.js';

/** A mutable copy of the incident fixture, with a helper to reach a node by id. */
function incident() {
	const document = structuredClone(incidentManagement) as unknown as {
		[key: string]: unknown;
		nodes: { core: Record<string, unknown>; content?: unknown; data?: Record<string, unknown> }[];
	};
	const node = (id: string) => {
		const index = document.nodes.findIndex((n) => n.core.id === id);
		const found = document.nodes[index];
		if (found === undefined) throw new Error(`no node ${id}`);
		return { index, node: found };
	};
	return { document, node };
}

function errorsOf(document: unknown): ValidationError[] {
	const result = validate(document);
	expect(result.valid).toBe(false);
	return result.errors;
}

describe('validate', () => {
	it('returns the typed document when it is valid', () => {
		const result = validate(structuredClone(incidentManagement));
		expect(result).toMatchObject({ valid: true, errors: [] });
		expect(result.valid && result.document.slug).toBe('incident-management');
	});

	it('rejects something that is not a document', () => {
		expect(errorsOf(42)).toEqual([
			{ path: '', field: 'document', keyword: 'type', message: 'document must be an object' }
		]);
	});

	it('reports missing metadata and a wrong schema version', () => {
		const { document } = incident();
		delete document.slug;
		document.schemaVersion = 2;
		document.namespace = 'Acme/SRE';
		expect(errorsOf(document).map((e) => e.message)).toEqual([
			'document is missing required field "slug"',
			'namespace must be a namespace path such as "acme/eng/sre"',
			'schemaVersion must be 1'
		]);
	});

	it('names the node and field of an invalid actor policy', () => {
		const { document, node } = incident();
		const { index, node: step } = node('step.form-working-group');
		step.core.actor = 'robot';
		expect(errorsOf(document)).toEqual([
			{
				path: `/nodes/${index}/core/actor`,
				nodeId: 'step.form-working-group',
				field: 'core.actor',
				keyword: 'enum',
				message: 'core.actor must be one of "human", "agent" or "either"'
			}
		]);
	});

	it('reports missing and unknown core fields for the node kind', () => {
		const { document, node } = incident();
		const { node: step } = node('step.resolve-incident');
		delete step.core.stage;
		step.core.owner = 'someone';
		expect(errorsOf(document).map((e) => [e.nodeId, e.message])).toEqual([
			['step.resolve-incident', 'core is missing required field "stage"'],
			['step.resolve-incident', 'core has unknown field "owner"']
		]);
	});

	it('rejects an unknown node kind', () => {
		const { document, node } = incident();
		node('stage.detect').node.core.kind = 'phase';
		expect(errorsOf(document).map((e) => e.message)).toEqual([
			'core.kind must be one of "process", "stage", "step", "fact", "role", "decision", "approval" or "lookup"'
		]);
	});

	it('requires ids and references to carry the right kind prefix', () => {
		const { document, node } = incident();
		const { node: step } = node('step.form-working-group');
		step.core.id = 'form-working-group';
		step.core.requires = ['role.incident-commander', 'fact.severity', 'fact.severity'];
		expect(errorsOf(document).map((e) => e.message)).toEqual([
			'core.id must be a step id: "step." followed by lowercase words joined by hyphens',
			'core.requires lists the same value twice (items 1 and 2)',
			'core.requires[0] must be a fact id: "fact." followed by lowercase words joined by hyphens'
		]);
	});

	it('prefixes the node index when the node has no readable id', () => {
		const { document, node } = incident();
		const { index, node: stage } = node('stage.detect');
		delete stage.core.id;
		expect(errorsOf(document)).toEqual([
			{
				path: `/nodes/${index}/core`,
				field: 'core',
				keyword: 'required',
				message: `node ${index}: core is missing required field "id"`
			}
		]);
	});

	it('checks guards and repeat intervals', () => {
		const { document, node } = incident();
		const { node: step } = node('step.post-status-update');
		step.core.when = { expr: 'fact.severity == "SEV1"' };
		step.core.repeat = { until: { text: '' }, every: 'every 30 minutes' };
		expect(errorsOf(document).map((e) => e.message)).toEqual([
			'core.repeat.every must be an ISO 8601 duration such as "PT30M"',
			'core.repeat.until.text must not be empty',
			'core.when is missing required field "text"'
		]);
	});

	it('requires data keys to be namespaced', () => {
		const { document, node } = incident();
		const { node: step } = node('step.form-working-group');
		step.data = { icon: 'users', 'ui.colour': 'blue' };
		expect(errorsOf(document)).toEqual([
			expect.objectContaining({
				nodeId: 'step.form-working-group',
				field: 'data',
				message: 'data key "icon" must be namespaced, such as "ui.icon" or "hooks.on_completed"'
			})
		]);
	});

	it('validates a fact value schema as JSON Schema 2020-12', () => {
		const { document, node } = incident();
		node('fact.severity').node.core.schema = { type: 'strng' };
		expect(errorsOf(document).map((e) => [e.nodeId, e.field, e.message])).toEqual([
			[
				'fact.severity',
				'core.schema.type',
				'core.schema.type must be one of "array", "boolean", "integer", "null", "number", "object" or "string", or must be an array'
			]
		]);
	});

	it('validates the x-lookup, x-evidence and x-sensitivity extensions', () => {
		const { document, node } = incident();
		node('fact.affected-services').node.core.schema = {
			type: 'array',
			'x-lookup': { kind: 'dataset' },
			'x-evidence': { description: 'Screenshot', copies: 0, formats: [] },
			'x-sensitivity': 'secret'
		};
		node('fact.working-group').node.core.schema = {
			type: 'array',
			'x-lookup': { kind: 'principal', role: 'role.service-owner', filter: 'on-call' }
		};
		expect(errorsOf(document).map((e) => [e.nodeId, e.message])).toEqual([
			['fact.affected-services', 'core.schema["x-evidence"].copies must be at least 1'],
			['fact.affected-services', 'core.schema["x-evidence"].formats must have at least 1 item'],
			['fact.affected-services', 'core.schema["x-lookup"] is missing required field "dataset"'],
			[
				'fact.affected-services',
				'core.schema["x-sensitivity"] must be one of "none", "personal" or "sensitive"'
			],
			['fact.working-group', 'core.schema["x-lookup"] has unknown field "filter"']
		]);
	});

	it('requires a source to say whether it was inferred', () => {
		const { document, node } = incident();
		node('step.report-incident').node.core.source = { doc: 'incident-runbook.md' };
		expect(errorsOf(document).map((e) => e.message)).toEqual([
			'core.source is missing required field "inferred"'
		]);
	});
});
