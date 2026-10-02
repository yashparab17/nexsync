// Pure helpers for tags, due dates and Kanban drag and drop, kept out of the pages so they can be tested

import type { KanbanColumn } from "@/types/workspace";

// The backend refuses more than this, so the UI stops first
export const MAX_TAGS = 10;
export const MAX_TAG_LENGTH = 32;

// "  #Back End " becomes "back-end"
export function normalizeTag(raw: string): string {
	return raw.trim().replace(/^#+/, "").trim().replace(/\s+/g, "-").toLowerCase().slice(0, MAX_TAG_LENGTH);
}

// Adds every tag in `raw` (comma or newline separated), skipping blanks and duplicates, up to the limit
export function addTags(tags: string[], raw: string): string[] {
	const next = [...tags];
	for (const part of raw.split(/[,\n]/)) {
		const tag = normalizeTag(part);
		if (tag && !next.includes(tag) && next.length < MAX_TAGS) next.push(tag);
	}
	return next;
}

// Every tag used by these items, alphabetically
export function collectTags(items: { tags?: string[] }[]): string[] {
	return [...new Set(items.flatMap((item) => item.tags ?? []))].sort();
}

// A stable colour per tag, so the same tag looks the same everywhere
export function tagHue(tag: string): number {
	let hash = 0;
	for (const ch of tag) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
	return hash;
}

// Today as YYYY-MM-DD in the user's time zone
export function localDay(date = new Date()): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const dayNumber = (day: string) => Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) / 86_400_000;

export type DueState = "overdue" | "today" | "soon" | "later";

// How urgent a due date is; null when there is nothing to warn about (no date, or already done).
// Due dates are calendar days, so only their first ten characters (YYYY-MM-DD) count.
export function dueState(due: string | undefined | null, done: boolean, today = localDay()): DueState | null {
	if (!due || done || !/^\d{4}-\d{2}-\d{2}/.test(due)) return null;
	const days = dayNumber(due) - dayNumber(today);
	if (days < 0) return "overdue";
	if (days === 0) return "today";
	return days <= 3 ? "soon" : "later";
}

export interface CardMove {
	id: string;
	column_id: string;
	position: number;
}

// A card's place in its column is a number, and dropping a card writes only that number, halfway between its new
// neighbours. So two devices moving different cards never write the same field, and two moves into the same gap
// still keep every card. The order is by position and then id, so equal positions sort the same on every device.
export const byOrder = (a: { position: number; id: string }, b: { position: number; id: string }) =>
	a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// The position that puts a card after every card in a column
export const endPosition = (cards: { position: number }[]) => (cards.length ? Math.max(...cards.map((c) => c.position)) + 1 : 0);

// Below this a gap is too small to halve again (about twenty drops into the same gap); the column is numbered afresh
const MIN_GAP = 1e-6;

// The position changes needed to drop a card at `index` of a column: normally just the moved card. Only when the
// neighbours are too close to halve again is the column renumbered. Empty when the card is already there.
export function planMove(columns: KanbanColumn[], cardId: string, targetColumnId: string, index: number): CardMove[] {
	const card = columns.flatMap((c) => c.cards).find((c) => c.id === cardId);
	const target = columns.find((c) => c.id === targetColumnId);
	if (!card || !target) return [];
	const sorted = [...target.cards].sort(byOrder);
	const rest = sorted.filter((c) => c.id !== cardId);
	const at = Math.max(0, Math.min(index, rest.length));
	if (card.column_id === targetColumnId && sorted.findIndex((c) => c.id === cardId) === at) return [];
	const prev = rest[at - 1]?.position;
	const next = rest[at]?.position;
	if (prev === undefined || next === undefined || next - prev > MIN_GAP) {
		const position = prev === undefined ? (next === undefined ? 0 : next - 1) : next === undefined ? prev + 1 : (prev + next) / 2;
		return [{ id: cardId, column_id: targetColumnId, position }];
	}
	const ordered = [...rest.slice(0, at), card, ...rest.slice(at)];
	return ordered
		.map((c, i) => ({ id: c.id, column_id: targetColumnId, position: i, was: c }))
		.filter(({ was, position }) => was.position !== position || was.column_id !== targetColumnId)
		.map(({ id, column_id, position }) => ({ id, column_id, position }));
}

// The weeks (Monday first) that cover a month, as YYYY-MM-DD strings; `month` is 0 to 11
export function monthGrid(year: number, month: number): string[][] {
	const pad = (n: number) => String(n).padStart(2, "0");
	const first = new Date(Date.UTC(year, month, 1));
	const offset = (first.getUTCDay() + 6) % 7;
	const count = Math.ceil((offset + new Date(Date.UTC(year, month + 1, 0)).getUTCDate()) / 7) * 7;
	const days = Array.from({ length: count }, (_, i) => {
		const d = new Date(Date.UTC(year, month, 1 - offset + i));
		return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
	});
	return Array.from({ length: count / 7 }, (_, w) => days.slice(w * 7, w * 7 + 7));
}
