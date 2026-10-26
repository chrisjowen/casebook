import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, AIMessageChunk, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { ChatGenerationChunk, type ChatResult } from '@langchain/core/outputs';

/** One scripted model response, given every message the model was sent. */
export type Step = (messages: BaseMessage[]) => AIMessage;

let ids = 0;

/** A response that calls one tool. */
export const call =
	(name: string, args: Record<string, unknown>): Step =>
	() =>
		new AIMessage({
			content: '',
			tool_calls: [{ name, args, id: `call_${++ids}`, type: 'tool_call' }]
		});

/** A final text reply. */
export const answer =
	(text: string): Step =>
	() =>
		new AIMessage(text);

/** The latest tool result the model was sent. */
export function lastToolResult(messages: BaseMessage[]): string {
	const found = [...messages].reverse().find((m) => ToolMessage.isInstance(m));
	if (!found) return '';
	const { content } = found;
	if (typeof content === 'string') return content;
	return content.map((block) => ('text' in block ? String(block.text) : '')).join('');
}

/**
 * A chat model that replays a script instead of calling an API: each call to the model takes the
 * next step. It records what it was sent, so tests can check the tool results the agent saw.
 */
export class ScriptedModel extends BaseChatModel {
	readonly sent: BaseMessage[][] = [];

	constructor(readonly script: Step[]) {
		super({});
	}

	_llmType() {
		return 'scripted';
	}

	override bindTools() {
		return this;
	}

	async _generate(messages: BaseMessage[]): Promise<ChatResult> {
		this.sent.push(messages);
		const step = this.script.shift();
		if (!step) throw new Error('The scripted model ran out of steps');
		const message = step(messages);
		return {
			generations: [{ message, text: typeof message.content === 'string' ? message.content : '' }]
		};
	}

	/** Steps not yet used; a finished test expects none. */
	get remaining() {
		return this.script.length;
	}
}

/**
 * A scripted model that streams each response, as Claude does: its text in a few pieces, then each
 * tool call's arguments as JSON in pieces of `piece` characters, waiting `pause` ms between pieces.
 */
export class StreamingScriptedModel extends ScriptedModel {
	constructor(
		script: Step[],
		readonly piece = 40,
		readonly pause = 20
	) {
		super(script);
	}

	override async *_streamResponseChunks(
		messages: BaseMessage[],
		_options: this['ParsedCallOptions'],
		runManager?: CallbackManagerForLLMRun
	): AsyncGenerator<ChatGenerationChunk> {
		this.sent.push(messages);
		const step = this.script.shift();
		if (!step) throw new Error('The scripted model ran out of steps');
		const message = step(messages);
		const text = typeof message.content === 'string' ? message.content : '';
		const chunks: AIMessageChunk[] = [];
		for (const words of text.match(/.{1,20}/gs) ?? []) chunks.push(new AIMessageChunk(words));
		(message.tool_calls ?? []).forEach((call, index) => {
			const json = JSON.stringify(call.args);
			for (let at = 0; at < json.length; at += this.piece) {
				chunks.push(
					new AIMessageChunk({
						content: '',
						tool_call_chunks: [
							{
								index,
								type: 'tool_call_chunk',
								args: json.slice(at, at + this.piece),
								...(at === 0 ? { name: call.name, id: call.id } : {})
							}
						]
					})
				);
			}
		});
		for (const chunk of chunks) {
			await new Promise((r) => setTimeout(r, this.pause));
			const generation = new ChatGenerationChunk({ message: chunk, text: String(chunk.content) });
			yield generation;
			await runManager?.handleLLMNewToken(
				generation.text,
				undefined,
				undefined,
				undefined,
				undefined,
				{
					chunk: generation
				}
			);
		}
	}
}
