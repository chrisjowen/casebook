/**
 * The chat model the wizard runs on. Any tool-calling chat model LangChain can start will do, named
 * by CASEBOOK_WIZARD_MODEL as `provider:model`:
 *
 * - `ollama:qwen2.5:7b` (the default): a local Ollama at OLLAMA_BASE_URL, http://127.0.0.1:11434
 *   unless set;
 * - `anthropic:claude-sonnet-5`: Claude, keyed by ANTHROPIC_API_KEY;
 * - `openai:<model>`: keyed by OPENAI_API_KEY, with OPENAI_BASE_URL for compatible servers.
 *
 * The agent itself is deepagents either way; only the chat model changes.
 */
import { ChatAnthropic } from '@langchain/anthropic';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatOllama } from '@langchain/ollama';
import { ChatOpenAI } from '@langchain/openai';

export const DEFAULT_MODEL = 'ollama:qwen2.5:7b';
export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';

/** Providers whose LangChain package this package installs. */
export const PROVIDERS = ['ollama', 'anthropic', 'openai'] as const;
export type Provider = (typeof PROVIDERS)[number];

export interface ModelSpec {
	provider: Provider;
	model: string;
}

/** Reads `provider:model`; the model name may itself contain colons, as Ollama tags do. */
export function parseModel(spec: string): ModelSpec {
	const at = spec.indexOf(':');
	const provider = spec.slice(0, at).trim();
	const model = spec.slice(at + 1).trim();
	if (at < 1 || !model) {
		throw new Error(
			`CASEBOOK_WIZARD_MODEL must be provider:model, such as ${DEFAULT_MODEL}, not "${spec}"`
		);
	}
	if (!PROVIDERS.includes(provider as Provider)) {
		throw new Error(`The wizard supports the providers ${PROVIDERS.join(', ')}, not "${provider}"`);
	}
	return { provider: provider as Provider, model };
}

/** The configured model, from `spec`, else CASEBOOK_WIZARD_MODEL, else the default. */
export function modelSpec(spec?: string): ModelSpec {
	return parseModel(spec ?? (process.env.CASEBOOK_WIZARD_MODEL?.trim() || DEFAULT_MODEL));
}

/** `ollama:qwen2.5:7b`, for showing which model the assistant runs on. */
export const modelName = (spec?: string) => {
	const { provider, model } = modelSpec(spec);
	return `${provider}:${model}`;
};

/** Starts the configured chat model, with each provider's settings from the environment. */
export function createChatModel(spec?: string): BaseChatModel {
	const { provider, model } = modelSpec(spec);
	switch (provider) {
		case 'ollama':
			// A whole turn's operations can arrive in one tool call, so give the model room for it.
			return new ChatOllama({
				model,
				baseUrl: process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_URL,
				numCtx: 32_768,
				temperature: 0
			});
		case 'anthropic':
			// Current Claude models choose their own sampling; leave room for a whole turn.
			return new ChatAnthropic({ model, maxTokens: 16_000, maxRetries: 2 });
		case 'openai':
			return new ChatOpenAI({
				model,
				maxRetries: 2,
				...(process.env.OPENAI_BASE_URL
					? { configuration: { baseURL: process.env.OPENAI_BASE_URL } }
					: {})
			});
	}
}

/**
 * Why the configured model cannot be used right now, in plain words, or undefined when it can:
 * Ollama must answer within a few seconds and have the model pulled; a hosted model needs its key.
 */
export async function modelProblem(spec?: string): Promise<string | undefined> {
	const { provider, model } = modelSpec(spec);
	if (provider === 'anthropic' && !process.env.ANTHROPIC_API_KEY) {
		return 'ANTHROPIC_API_KEY is not set, so the assistant cannot reach Claude.';
	}
	if (provider === 'openai' && !process.env.OPENAI_API_KEY && !process.env.OPENAI_BASE_URL) {
		return 'OPENAI_API_KEY is not set, so the assistant cannot reach OpenAI.';
	}
	if (provider !== 'ollama') return undefined;
	const url = process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_URL;
	let names: string[];
	try {
		const response = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(5_000) });
		const body = (await response.json()) as { models?: { name: string }[] };
		names = (body.models ?? []).map((m) => m.name);
	} catch {
		return `Ollama is not answering at ${url}. Start it with "ollama serve" and try again.`;
	}
	const wanted = model.includes(':') ? model : `${model}:latest`;
	if (!names.includes(wanted)) {
		return `Ollama does not have the model ${model}. Pull it with "ollama pull ${model}", or set CASEBOOK_WIZARD_MODEL to one it has.`;
	}
	return undefined;
}
