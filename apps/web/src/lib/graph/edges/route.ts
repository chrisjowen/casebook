// Rounded orthogonal path through ELK bend points.
type Pt = { x: number; y: number };
export function roundedPath(pts: Pt[], r = 8) {
	if (pts.length < 2) return '';
	let d = `M ${pts[0].x} ${pts[0].y}`;
	for (let i = 1; i < pts.length - 1; i++) {
		const a = pts[i - 1],
			b = pts[i],
			c = pts[i + 1];
		const d1 = Math.hypot(b.x - a.x, b.y - a.y),
			d2 = Math.hypot(c.x - b.x, c.y - b.y);
		const rr = Math.min(r, d1 / 2, d2 / 2);
		const p1 = { x: b.x + ((a.x - b.x) / d1) * rr, y: b.y + ((a.y - b.y) / d1) * rr };
		const p2 = { x: b.x + ((c.x - b.x) / d2) * rr, y: b.y + ((c.y - b.y) / d2) * rr };
		d += ` L ${p1.x} ${p1.y} Q ${b.x} ${b.y} ${p2.x} ${p2.y}`;
	}
	const last = pts[pts.length - 1];
	return d + ` L ${last.x} ${last.y}`;
}
/** Midpoint along the longest segment, for label placement. */
export function labelPoint(pts: Pt[]): Pt {
	let best = 0,
		at = { x: pts[0].x, y: pts[0].y };
	for (let i = 1; i < pts.length; i++) {
		const len = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
		if (len > best) {
			best = len;
			at = { x: (pts[i].x + pts[i - 1].x) / 2, y: (pts[i].y + pts[i - 1].y) / 2 };
		}
	}
	return at;
}
