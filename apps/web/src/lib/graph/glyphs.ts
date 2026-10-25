import {
	Type,
	Hash,
	ToggleLeft,
	CalendarDays,
	ListChecks,
	Paperclip,
	Users,
	Search,
	List,
	Link,
	Braces
} from '@lucide/svelte';
import type { FactGlyph } from './derive';

export const glyphIcon: Record<FactGlyph, typeof Type> = {
	text: Type,
	number: Hash,
	yesno: ToggleLeft,
	date: CalendarDays,
	choice: ListChecks,
	document: Paperclip,
	people: Users,
	lookup: Search,
	list: List,
	link: Link,
	record: Braces
};
