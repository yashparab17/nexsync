// The merge lens for rich text (Notes and Documents). Both keep their text as a tree of blocks in a Yjs XML fragment, and the editor
// shows the same tree, so a character's place in the fragment is its place on the page once each block's opening and closing are
// counted. That lets the same two questions as the code editor's lens be answered here: who wrote each block, and where two people's
// text was merged.

import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import * as Y from "yjs";

import { colorOf } from "@/lib/collabColor";
import type { AuthorInfo } from "@/lib/editor/blame";
import { spotsFrom, type MergeSpot, type Run } from "@/lib/editor/lens";

interface Item {
	deleted: boolean;
	countable: boolean;
	length: number;
	right: Item | null;
	id: { client: number; clock: number };
	origin: { client: number; clock: number } | null;
	rightOrigin: { client: number; clock: number } | null;
}

export interface BlockOwner {
	// The block's place in the editor's positions, from before it to after it
	from: number;
	to: number;
	client: number;
}

const idKey = (id: { client: number; clock: number } | null) => (id ? `${id.client}:${id.clock}` : "-");

// ponytail: walks the whole fragment on each refresh; fine for notes and ordinary documents, index by block if a very long one lags.
export function xmlRuns(fragment: Y.XmlFragment): { runs: Run[]; blocks: BlockOwner[] } {
	const runs: Run[] = [];
	const blocks: BlockOwner[] = [];
	let pos = 0;
	const walk = (parent: Y.XmlFragment | Y.XmlElement) => {
		const counts = new Map<number, number>();
		const start = pos - 1;
		for (const child of parent.toArray()) {
			if (child instanceof Y.XmlText) {
				for (let item = (child as unknown as { _start: Item | null })._start; item; item = item.right) {
					if (item.deleted || !item.countable) continue;
					runs.push({ client: item.id.client, from: pos, to: pos + item.length, key: `${idKey(item.origin)}|${idKey(item.rightOrigin)}` });
					counts.set(item.id.client, (counts.get(item.id.client) ?? 0) + item.length);
					pos += item.length;
				}
			} else if (child instanceof Y.XmlElement) {
				pos += 1;
				walk(child);
				pos += 1;
			}
		}
		const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
		if (top && parent instanceof Y.XmlElement) blocks.push({ from: start, to: pos + 1, client: top[0] });
	};
	walk(fragment);
	return { runs, blocks };
}

export function mergeSpotsXml(fragment: Y.XmlFragment, authors: Y.Map<AuthorInfo>): MergeSpot[] {
	return spotsFrom(xmlRuns(fragment).runs, authors);
}

// Whether the lens is on, and who is told of the places found
export interface LensStore {
	on: boolean;
	onSpots?: (spots: MergeSpot[]) => void;
	// Set by the plugin: asks it to look again (after the lens is switched on or off)
	refresh: () => void;
}

export const newLensStore = (): LensStore => ({ on: false, refresh: () => {} });

interface Found {
	blocks: { from: number; to: number; name: string }[];
	spots: MergeSpot[];
}

const key = new PluginKey<DecorationSet>("mergeLens");

// Tints each block by its author and underlines the text where two people's writing was merged. What the editor shows is read from
// the shared document a moment after it changes, because an edit reaches the shared text only after the editor has applied it.
export function mergeLensPlugin(doc: Y.Doc, store: LensStore): Plugin {
	const fragment = doc.getXmlFragment("blocknote");
	const authors = doc.getMap<AuthorInfo>("authors");
	const found = (): Found => {
		const { runs, blocks } = xmlRuns(fragment);
		return {
			blocks: blocks.map((b) => ({ from: b.from, to: b.to, name: authors.get(String(b.client))?.name ?? "Unknown" })),
			spots: spotsFrom(runs, authors),
		};
	};
	return new Plugin({
		key,
		state: {
			init: () => DecorationSet.empty,
			apply(tr, old, _before, state) {
				const meta = tr.getMeta(key) as Found | "off" | undefined;
				if (meta === "off") return DecorationSet.empty;
				if (!meta) return tr.docChanged ? old.map(tr.mapping, tr.doc) : old;
				const list: Decoration[] = [];
				for (const b of meta.blocks) {
					const node = b.from >= 0 && b.to <= state.doc.content.size ? state.doc.nodeAt(b.from) : null;
					if (node && node.nodeSize === b.to - b.from) list.push(Decoration.node(b.from, b.to, { class: "nx-lens-block", style: `--lens:${colorOf(b.name)}`, title: b.name }));
				}
				for (const s of meta.spots) {
					if (s.to > s.from && s.to <= state.doc.content.size) list.push(Decoration.inline(s.from, s.to, { class: "nx-lens-merge", title: `${s.authors.join(" and ")} wrote here at the same time` }));
				}
				return DecorationSet.create(state.doc, list);
			},
		},
		props: { decorations: (state) => key.getState(state) },
		view(view) {
			let timer: ReturnType<typeof setTimeout> | undefined;
			let gone = false;
			const run = () => {
				if (gone) return;
				if (!store.on) {
					store.onSpots?.([]);
					view.dispatch(view.state.tr.setMeta(key, "off"));
					return;
				}
				const next = found();
				store.onSpots?.(next.spots);
				view.dispatch(view.state.tr.setMeta(key, next).setMeta("addToHistory", false));
			};
			const schedule = () => {
				clearTimeout(timer);
				timer = setTimeout(run, 300);
			};
			store.refresh = schedule;
			authors.observe(schedule);
			return {
				update: (_view, previous) => {
					if (store.on && !_view.state.doc.eq(previous.doc)) schedule();
				},
				destroy: () => {
					gone = true;
					clearTimeout(timer);
					authors.unobserve(schedule);
				},
			};
		},
	});
}
