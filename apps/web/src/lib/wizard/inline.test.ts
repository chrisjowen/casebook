import { describe, expect, it } from 'vitest';
import { inlineRuns } from './inline';

describe('inlineRuns', () => {
	it('reads bold and code marks, leaving the rest as text', () => {
		expect(inlineRuns('1. **Birth** uses `fact.x`, <b>not</b> html')).toEqual([
			{ text: '1. ' },
			{ text: 'Birth', style: 'bold' },
			{ text: ' uses ' },
			{ text: 'fact.x', style: 'code' },
			{ text: ', <b>not</b> html' }
		]);
		expect(inlineRuns('a ** b')).toEqual([{ text: 'a ** b' }]);
	});
});
