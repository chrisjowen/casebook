import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';

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
