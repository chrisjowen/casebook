/**
 * The board's passing UI state (menus, the quick-add box, the link box, renaming) and the actions
 * its nodes call, shared through Svelte context. Edits themselves go through the page's `Editor`.
 */
import { getContext, setContext } from 'svelte';
import type { HandOff } from './derive';

export interface MenuItem {
	label: string;
	icon?: unknown;
	run?: () => void;
	danger?: boolean;
	/** Why it is unavailable, shown instead of running it. */
	disabled?: string;
	kbd?: string;
	/** A longer explanation, shown on hover. */
	hint?: string;
	sep?: boolean;
}

export interface MenuState {
	x: number;
	y: number;
	title?: string;
	items: MenuItem[];
}

/** Where a quick add was asked for, and what the new item connects to. */
export interface AddContext {
	x: number;
	y: number;
	stage: string;
	/** The item it comes after: it needs what that item records. */
	after?: string;
	/** A fact dragged off a card: the new item needs it. */
	fact?: string;
	/** A decision's choice dragged off its card: the new item runs only for that choice. */
	branch?: { decision: string; choice: string };
	/** A link the new step goes between. */
	insert?: HandOff;
	/** Offer a decision first, as when asked for one by key or button. */
	kind?: 'step' | 'decision';
}

export interface PickerState {
	x: number;
	y: number;
	from: string;
	to: string;
	/** Put the cursor in the new-fact box straight away. */
	create?: boolean;
}

export interface Command {
	group: string;
	label: string;
	icon: unknown;
	run: () => void;
	hint?: string;
}

export class BoardUI {
	/** Mirrors the page's selection, so nodes and links can light up what touches it. */
	selected = $state<string | undefined>();
	renaming = $state<string | undefined>();
	dropStage = $state<string | undefined>();
	connecting = $state(false);
	highlightFact = $state<string | undefined>();
	addingStage = $state(false);
	menu = $state<MenuState | undefined>();
	add = $state<AddContext | undefined>();
	picker = $state<PickerState | undefined>();
	palette = $state(false);

	closePopovers() {
		this.menu = undefined;
		this.add = undefined;
		this.picker = undefined;
	}
}

export interface BoardActions {
	/** False for someone who cannot edit the draft: the board is then for viewing only. */
	readonly editable: boolean;
	select(id: string | undefined): void;
	rename(id: string, title: string): void;
	cardMenu(id: string, x: number, y: number): void;
	stageMenu(id: string, x: number, y: number): void;
	quickAdd(ctx: AddContext): void;
	addStage(title: string): Promise<boolean>;
	/** Adds a fact a step records, by name, from the card itself. */
	addFact(item: string, title: string): void;
	addChoice(decision: string, choice: string): void;
	/** Names of the process's facts, offered while typing one on a card. */
	factTitles(): string[];
	editHandOff(h: HandOff, x: number, y: number): void;
	insertStep(h: HandOff, x: number, y: number): void;
}

const KEY = Symbol('casebook-board');

export function setBoard(ui: BoardUI, actions: BoardActions) {
	setContext(KEY, { ui, actions });
}

export function getBoard(): { ui: BoardUI; actions: BoardActions } {
	return getContext(KEY);
}
