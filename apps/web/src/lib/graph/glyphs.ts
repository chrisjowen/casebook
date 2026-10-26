import Type from '@lucide/svelte/icons/type';
import Hash from '@lucide/svelte/icons/hash';
import ToggleLeft from '@lucide/svelte/icons/toggle-left';
import CalendarDays from '@lucide/svelte/icons/calendar-days';
import ListChecks from '@lucide/svelte/icons/list-checks';
import Paperclip from '@lucide/svelte/icons/paperclip';
import Users from '@lucide/svelte/icons/users';
import Search from '@lucide/svelte/icons/search';
import List from '@lucide/svelte/icons/list';
import Link from '@lucide/svelte/icons/link';
import Braces from '@lucide/svelte/icons/braces';
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
