// Every emoji, by category and by search. The list (names and search words) is loaded the first time the picker opens, so it costs nothing until
// then. Emoji of Unicode 14 or older only, which the computers in use draw; a person with one of the family or profession sequences is kept to
// the single-person ones, so that what is picked fits in a workspace icon (see `parseIcon`).

import { useEffect, useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Entry {
	glyph: string;
	name: string;
	words: string;
}

interface Group {
	id: string;
	label: string;
	emoji: Entry[];
}

const LABELS: Record<string, string> = { people: "People", nature: "Nature", foods: "Food", activity: "Activity", places: "Places", objects: "Objects", symbols: "Symbols", flags: "Flags" };
const ICON: Record<string, string> = { people: "😀", nature: "🌿", foods: "🍎", activity: "⚽", places: "🏠", objects: "💡", symbols: "🔣", flags: "🏁" };

let loaded: Promise<Group[]> | null = null;

// The groups, from the data package; the same list is kept for every picker opened afterwards
export function loadEmoji(): Promise<Group[]> {
	loaded ??= import("@emoji-mart/data/sets/14/native.json").then((m) => {
		const data = (m.default ?? m) as unknown as { categories: { id: string; emojis: string[] }[]; emojis: Record<string, { name: string; keywords: string[]; version: number; skins: { native: string }[] }> };
		return data.categories
			.filter((c) => c.id !== "frequent")
			.map((c) => ({
				id: c.id,
				label: LABELS[c.id] ?? c.id,
				emoji: c.emojis.flatMap((id) => {
					const e = data.emojis[id];
					const glyph = e?.skins[0]?.native;
					if (!e || !glyph || e.version > 14 || [...glyph].length > 8) return [];
					return [{ glyph, name: e.name, words: `${e.name} ${e.keywords.join(" ")}`.toLowerCase() }];
				}),
			}));
	});
	return loaded;
}

// The entries whose name or search words contain every word typed
export function searchEmoji(groups: Group[], query: string): Entry[] {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (words.length === 0) return [];
	return groups.flatMap((g) => g.emoji).filter((e) => words.every((w) => e.words.includes(w)));
}

export default function EmojiPicker({ value, onPick }: { value: string | null; onPick: (glyph: string) => void }) {
	const [groups, setGroups] = useState<Group[] | null>(null);
	const [failed, setFailed] = useState(false);
	const [query, setQuery] = useState("");
	const [group, setGroup] = useState("people");

	useEffect(() => {
		let live = true;
		loadEmoji()
			.then((g) => live && setGroups(g))
			.catch(() => live && setFailed(true));
		return () => {
			live = false;
		};
	}, []);

	const shown = useMemo(() => {
		if (!groups) return [];
		return query.trim() ? searchEmoji(groups, query) : (groups.find((g) => g.id === group)?.emoji ?? []);
	}, [groups, query, group]);

	if (failed) return <p className="text-[13px] text-destructive">The emoji could not be loaded.</p>;

	return (
		<div className="flex flex-col gap-2 border p-2">
			<Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search emoji" aria-label="Search emoji" autoComplete="off" />
			{!query.trim() && (
				<div role="tablist" aria-label="Emoji categories" className="flex gap-1">
					{(groups ?? []).map((g) => (
						<button
							key={g.id}
							type="button"
							role="tab"
							aria-selected={group === g.id}
							aria-label={g.label}
							title={g.label}
							onClick={() => setGroup(g.id)}
							className={cn("flex size-8 cursor-pointer items-center justify-center rounded-md text-base outline-none hover:bg-muted focus-visible:bg-muted", group === g.id && "bg-primary/20")}
						>
							{ICON[g.id] ?? "•"}
						</button>
					))}
				</div>
			)}
			<div role="group" aria-label="Emoji" className="grid max-h-44 grid-cols-[repeat(auto-fill,minmax(2rem,1fr))] gap-1 overflow-y-auto">
				{groups === null ? (
					<p className="col-span-full text-[13px] text-muted-foreground">Loading…</p>
				) : shown.length === 0 ? (
					<p className="col-span-full text-[13px] text-muted-foreground">No emoji match.</p>
				) : (
					shown.map((e) => (
						<button
							key={e.glyph + e.name}
							type="button"
							title={e.name}
							aria-label={e.name}
							aria-pressed={value === e.glyph}
							onClick={() => onPick(e.glyph)}
							className={cn("flex size-8 cursor-pointer items-center justify-center rounded-md text-lg outline-none hover:bg-muted focus-visible:bg-muted", value === e.glyph && "bg-primary/20")}
						>
							{e.glyph}
						</button>
					))
				)}
			</div>
		</div>
	);
}
