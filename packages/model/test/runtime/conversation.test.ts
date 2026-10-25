import { describe, expect, it } from 'vitest';
import { awaitingAnswer, foldConversation, type ConversationEvent } from '../../src/index.js';

let seq = 0;
const event = (e: Omit<ConversationEvent, 'seq' | 'at'>): ConversationEvent => ({
	...e,
	seq: ++seq,
	at: new Date(Date.UTC(2026, 9, 1, 0, seq)).toISOString()
});

describe('foldConversation', () => {
	it('keeps the latest saved draft of a form until the item is completed', () => {
		const saved = foldConversation([
			event({ type: 'step.saved', item: 'a', by: 'alex', data: { values: { x: ['1'] } } }),
			event({ type: 'step.saved', item: 'a', by: 'sam', data: { values: { x: ['2'] } } }),
			event({ type: 'step.saved', item: 'b', by: 'sam', data: { values: { y: ['3'] } } }),
			event({ type: 'step.completed', item: 'b', by: 'sam' })
		]);
		expect(saved.drafts).toEqual({
			a: expect.objectContaining({ by: 'sam', values: { x: ['2'] } })
		});
	});

	it('threads replies under their question and notes when it is answered and resolved', () => {
		const asked = event({
			type: 'question.asked',
			item: 'a',
			by: 'alex',
			data: { to: 'dana', text: 'Which hospital?' }
		});
		const before = foldConversation([asked]).questions[0]!;
		expect(before).toMatchObject({ id: asked.seq, to: 'dana', answered: false });
		expect(awaitingAnswer(before)).toBe(true);

		const replied = foldConversation([
			asked,
			event({
				type: 'question.replied',
				item: 'a',
				by: 'alex',
				data: { question: asked.seq, text: 'Any idea?' }
			}),
			event({
				type: 'question.replied',
				item: 'a',
				by: 'dana',
				data: { question: asked.seq, text: 'Riverside' }
			})
		]).questions[0]!;
		expect(replied.replies.map((r) => r.text)).toEqual(['Any idea?', 'Riverside']);
		expect(replied.answered).toBe(true);
		expect(awaitingAnswer(replied)).toBe(false);

		const followUp = foldConversation([
			asked,
			event({
				type: 'question.replied',
				item: 'a',
				by: 'dana',
				data: { question: asked.seq, text: 'Riverside' }
			}),
			event({
				type: 'question.replied',
				item: 'a',
				by: 'alex',
				data: { question: asked.seq, text: 'Which ward?' }
			})
		]).questions[0]!;
		expect(awaitingAnswer(followUp)).toBe(true);

		const resolved = foldConversation([
			asked,
			event({ type: 'question.resolved', item: 'a', by: 'alex', data: { question: asked.seq } })
		]).questions[0]!;
		expect(resolved.resolved).toMatchObject({ by: 'alex' });
		expect(awaitingAnswer(resolved)).toBe(false);
	});

	it('closes the questions still open on an item when it is finished', () => {
		const asked = event({
			type: 'question.asked',
			item: 'a',
			by: 'alex',
			data: { to: 'dana', text: 'Which hospital?' }
		});
		const { questions } = foldConversation([
			asked,
			event({ type: 'step.completed', item: 'a', by: 'sam' })
		]);
		expect(questions[0]!.resolved).toMatchObject({ by: 'sam' });
	});

	it('ignores replies to a question it never saw', () => {
		const { questions } = foldConversation([
			event({
				type: 'question.replied',
				item: 'a',
				by: 'dana',
				data: { question: 999, text: 'Hm' }
			})
		]);
		expect(questions).toEqual([]);
	});
});
