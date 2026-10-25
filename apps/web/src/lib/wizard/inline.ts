/** A run of reply text, plain, bold (`**x**`) or code (`` `x` ``). */
export interface Run {
	text: string;
	style?: 'bold' | 'code';
}

/**
 * Splits a model's reply into runs for its two common inline marks, so they read as intended
 * without rendering any HTML from the model.
 */
export function inlineRuns(text: string): Run[] {
	const runs: Run[] = [];
	const pattern = /\*\*([^*]+)\*\*|`([^`]+)`/g;
	let at = 0;
	for (const m of text.matchAll(pattern)) {
		if (m.index > at) runs.push({ text: text.slice(at, m.index) });
		runs.push(m[1] !== undefined ? { text: m[1], style: 'bold' } : { text: m[2]!, style: 'code' });
		at = m.index + m[0].length;
	}
	if (at < text.length) runs.push({ text: text.slice(at) });
	return runs;
}
