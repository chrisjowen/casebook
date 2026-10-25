import type { DefinitionDocument, Node } from '../../src/index.js';

/** Wraps nodes in document metadata, for the deliberately broken fixtures. */
export function brokenDocument(slug: string, nodes: Node[]): DefinitionDocument {
	return { schemaVersion: 1, namespace: 'examples/broken', slug, version: 1, nodes };
}

/** A process, a stage and a role that the broken fixtures build on. */
export const scaffold: Node[] = [
	{ core: { id: 'process.example', kind: 'process' } },
	{ core: { id: 'stage.main', kind: 'stage' } },
	{ core: { id: 'role.clerk', kind: 'role' } }
];
