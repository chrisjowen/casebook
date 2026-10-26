/**
 * The chat model the wizard runs on. Any tool-calling chat model LangChain can start will do, named
 * by CASEBOOK_WIZARD_MODEL as `provider:model`. Unset, it is Claude when ANTHROPIC_API_KEY is set
 * and a local Ollama otherwise:
 *
 * - `anthropic:claude-sonnet-5`: Claude, keyed by ANTHROPIC_API_KEY;
 * - `ollama:qwen2.5:7b`: a local Ollama at OLLAMA_BASE_URL, http://127.0.0.1:11434 unless set;
 * - `openai:<model>`: keyed by OPENAI_API_KEY, with OPENAI_BASE_URL for compatible servers.
 *
 * The agent itself is deepagents either way; only the chat model changes.
 */
import { ChatAnthropic } from '@langchain/anthropic';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatOllama } from '@langchain/ollama';
import { ChatOpenAI } from '@langchain/openai';

/** The model when ANTHROPIC_API_KEY is set and CASEBOOK_WIZARD_MODEL is not. */
export const DEFAULT_CLAUDE_MODEL = 'anthropic:claude-sonnet-5';
/** The model when neither is set. */
export const DEFAULT_MODEL = 'ollama:qwen2.5:7b';
export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
/** How hard Claude thinks before it answers, unless CASEBOOK_WIZARD_EFFORT says otherwise. */
export const DEFAULT_EFFORT = 'low';
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORTS)[number];

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

/** The model used when none is named: Claude when its key is set, else the local default. */
export const defaultModel = () =>
	process.env.ANTHROPIC_API_KEY?.trim() ? DEFAULT_CLAUDE_MODEL : DEFAULT_MODEL;

/** The configured model, from `spec`, else CASEBOOK_WIZARD_MODEL, else the default. */
export function modelSpec(spec?: string): ModelSpec {
	return parseModel(spec ?? (process.env.CASEBOOK_WIZARD_MODEL?.trim() || defaultModel()));
}

/** The thinking effort for Claude, from CASEBOOK_WIZARD_EFFORT, else `low`. */
export function wizardEffort(): Effort {
	const set = process.env.CASEBOOK_WIZARD_EFFORT?.trim().toLowerCase();
	if (!set) return DEFAULT_EFFORT;
	if (!EFFORTS.includes(set as Effort)) {
		throw new Error(`CASEBOOK_WIZARD_EFFORT must be one of ${EFFORTS.join(', ')}, not "${set}"`);
	}
	return set as Effort;
}

/**
 * Whether a Claude model takes an effort level: Sonnet, Opus and later families from 4.6 on (Haiku
 * and older models refuse the setting).
 */
export function takesEffort(model: string): boolean {
	const match = /^claude-(opus|sonnet|fable|mythos)-(\d+)(?:-(\d+))?(?:$|-)/.exec(model);
	if (!match) return false;
	const major = Number(match[2]);
	const minor = match[3] && match[3].length <= 2 ? Number(match[3]) : 0;
	return major > 4 || (major === 4 && minor >= 6);
}

/**
 * Claude with its tool inputs streamed as they are written (`eager_input_streaming`), so a long list
 * of operations reaches the panel as it is generated instead of all at once at the end. The tools
 * still check every input in full once it has arrived.
 */
class StreamingToolsAnthropic extends ChatAnthropic {
	override formatStructuredToolToAnthropic(
		...args: Parameters<ChatAnthropic['formatStructuredToolToAnthropic']>
	): ReturnType<ChatAnthropic['formatStructuredToolToAnthropic']> {
		return super
			.formatStructuredToolToAnthropic(...args)
			?.map((tool) =>
				'input_schema' in tool && !('type' in tool && tool.type)
					? ({ ...tool, eager_input_streaming: true } as typeof tool)
					: tool
			);
	}
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
			// Current Claude models choose their own sampling. They think before answering, which at
			// the default effort took most of a minute per call on the wizard's turns, unseen; a low
			// effort keeps a whole draft to well under a minute. max_tokens leaves room for one call
			// holding a whole process's operations (about 4,000 tokens) with its thinking.
			return new StreamingToolsAnthropic({
				model,
				maxTokens: 16_000,
				maxRetries: 2,
				...(takesEffort(model) ? { outputConfig: { effort: wizardEffort() } } : {})
			});
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
