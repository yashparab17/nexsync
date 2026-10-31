// Locked sections: an Owner or Admin can lock a section so that only Owners and Admins change its text; everyone else can still read and
// comment. A section is the stretch from the paragraph that starts it (the one with a section break) to the next such paragraph; the first
// section starts at the top. The locked ones are listed in the shared document by the id of their first block. As with Restrict Editing,
// each device enforces it by refusing the edit, so a changed copy of the app could ignore it.

import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import type { Node as PmNode } from "@tiptap/pm/model";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export const FIRST = "start";

export interface SectionRange {
	// The id of the block that starts it, or FIRST
	key: string;
	from: number;
	to: number;
}

const startsSection = (container: PmNode): boolean => {
	const content = container.firstChild;
	return !!content && typeof content.attrs.sectionBreak === "string" && content.attrs.sectionBreak !== "";
};

// The sections of a document with the places they cover: each top-level block belongs to the section it follows
export function sectionRanges(doc: PmNode): SectionRange[] {
	const out: SectionRange[] = [];
	doc.descendants((node, pos) => {
		if (node.type.name !== "blockGroup") return true;
		// Only the top-level group: its children are the page's blocks
		if (out.length || pos !== 0) return false;
		node.forEach((child, offset) => {
			const from = pos + 1 + offset;
			const id = typeof child.attrs.id === "string" ? child.attrs.id : "";
			if (out.length === 0) out.push({ key: FIRST, from, to: from + child.nodeSize });
			else if (startsSection(child) && id) out.push({ key: id, from, to: from + child.nodeSize });
			else out[out.length - 1].to = from + child.nodeSize;
		});
		return false;
	});
	return out;
}

// The section a place is in
export const sectionAt = (ranges: SectionRange[], pos: number): SectionRange | undefined => ranges.find((r) => pos >= r.from && pos < r.to) ?? ranges[ranges.length - 1];

// The stretches of the old document a transaction changes
function touched(tr: Transaction): [number, number][] {
	const out: [number, number][] = [];
	tr.mapping.maps.forEach((map, i) => {
		map.forEach((from, to) => {
			// Back to the place in the document before the transaction
			let a = from;
			let b = to;
			for (let k = i - 1; k >= 0; k--) {
				const inv = tr.mapping.maps[k].invert();
				a = inv.map(a, -1);
				b = inv.map(b, 1);
			}
			out.push([a, Math.max(a, b)]);
		});
	});
	return out;
}

export interface LockStore {
	locked: Set<string>;
	isAdmin: boolean;
	// Told when an edit was refused
	onRefused?: () => void;
}

export const newLockStore = (): LockStore => ({ locked: new Set(), isAdmin: false });

// A change is refused when it touches a locked section; what other people send is never refused (it is already in the shared text)
export function refuses(store: LockStore, tr: Transaction): boolean {
	if (store.isAdmin || store.locked.size === 0 || !tr.docChanged || tr.getMeta("y-sync$") != null) return false;
	const ranges = sectionRanges(tr.before).filter((r) => store.locked.has(r.key));
	if (ranges.length === 0) return false;
	return touched(tr).some(([a, b]) => ranges.some((r) => (a === b ? a > r.from && a < r.to : a < r.to && b > r.from)));
}

const key = new PluginKey("docLocks");

export function lockedSectionsPlugin(store: LockStore): Plugin {
	return new Plugin({
		key,
		filterTransaction(tr) {
			if (!refuses(store, tr)) return true;
			store.onRefused?.();
			return false;
		},
		props: {
			// A locked section shows a line down its side
			decorations(state) {
				if (store.locked.size === 0) return null;
				const found = sectionRanges(state.doc).filter((r) => store.locked.has(r.key));
				if (found.length === 0) return null;
				return DecorationSet.create(
					state.doc,
					found.flatMap((r) => {
						const list: Decoration[] = [];
						state.doc.nodesBetween(r.from, r.to, (n, pos) => {
							if (n.type.name === "blockContainer" && pos >= r.from && pos < r.to) {
								list.push(Decoration.node(pos, pos + n.nodeSize, { class: "doc-locked" }));
								return false;
							}
							return true;
						});
						return list;
					}),
				);
			},
		},
	});
}
