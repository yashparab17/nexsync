// What a Word file says about each paragraph that BlockNote has no place for: the space above and below, the indent, and whether it is a
// line of a table of contents. The backend writes it on each element as `data-nx-sp="before,after,left,first,toc"` (points); it is read from
// the HTML before the blocks are made, matched to the blocks by order, and drawn by a ProseMirror decoration keyed on the block's id, so it
// stays with its paragraph while the text around it changes.

import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { EditorView } from "@tiptap/pm/view";

export interface ParaSpacing {
	before: number;
	after: number;
	left: number;
	first: number;
	toc: boolean;
	// The block starts a new page, and (for the first block of a section) how the section's text sits on its page: c, b, j or -
	brk?: boolean;
	valign?: string;
	// Stays on the page of the block after it (the paragraph's own "keep with next")
	keep?: boolean;
}

// Elements the editor makes a block of (not the paragraphs inside tables or code), in document order
const BLOCKS = "p,h1,h2,h3,h4,h5,h6,li,hr,blockquote > *";

export function spacingOf(attr: string | null): ParaSpacing | undefined {
	if (!attr) return undefined;
	const parts = attr.split(",");
	const [before, after, left, first, toc, brk] = parts.map(Number);
	if ([before, after, left, first].some((n) => !Number.isFinite(n))) return undefined;
	const v = parts[6];
	return { before: clamp(before), after: clamp(after), left: clamp(left), first: Math.max(-200, Math.min(200, first)), toc: toc === 1, brk: brk === 1, valign: v === "c" || v === "b" || v === "j" ? v : undefined, keep: parts[7] === "1" };
}

const clamp = (n: number) => Math.max(0, Math.min(200, n));

const norm = (s: string) => s.replace(/[\s ]+/g, " ").trim();

// One entry per paragraph-like element of the HTML, in order, with its own text (not that of a list nested in it); `sp` is undefined where
// the file says nothing
export function spacingsOfHtml(html: string): { text: string; sp: ParaSpacing | undefined }[] {
	const body = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html").body;
	return Array.from(body.querySelectorAll(BLOCKS))
		// An element with nothing in it at all (`<p></p>`) is dropped by the editor, so it makes no block
		.filter((el) => !el.closest("table,pre") && el.hasChildNodes())
		.map((el) => {
			const sp = spacingOf(el.getAttribute("data-nx-sp"));
			const own = el.cloneNode(true) as Element;
			own.querySelectorAll("ul,ol,table").forEach((n) => n.remove());
			// An explicit page break (a paragraph that begins a page)
			const breaks = (el as HTMLElement).style?.breakBefore === "page" || (el as HTMLElement).style?.pageBreakBefore === "always";
			return { text: norm(own.textContent ?? ""), sp: breaks ? { before: 0, after: 8, left: 0, first: 0, toc: false, ...sp, brk: true } : sp };
		});
}

// Pairs the file's paragraphs with the blocks the editor made of them, by their text in order. Tables, pictures and anything else that
// became a different number of blocks are stepped over (a block with `text: null` never matches), so one of them does not cost the rest
// of the document its spacing.
export function matchSpacing(specs: { text: string; sp: ParaSpacing | undefined }[], blocks: { id: string; text: string | null }[]): Map<string, ParaSpacing> {
	const out = new Map<string, ParaSpacing>();
	let j = 0;
	for (const s of specs) {
		// ponytail: a fixed look-ahead; a paragraph more than 12 blocks from where it is expected is left plain
		for (let k = j; k < Math.min(blocks.length, j + 12); k++) {
			if (blocks[k].text !== null && norm(blocks[k].text!) === s.text) {
				if (s.sp) out.set(blocks[k].id, s.sp);
				j = k + 1;
				break;
			}
		}
	}
	return out;
}

const style = (s: ParaSpacing) =>
	[s.before > 0 && `border-top:${s.before}pt solid transparent`, s.after >= 0 && `padding-bottom:${s.after}pt`, s.left > 0 && `padding-left:${s.left}pt`, s.toc && `--nx-left:${s.left}pt`, s.first !== 0 && s.left + s.first >= 0 && `text-indent:${s.first}pt`]
		.filter(Boolean)
		.join(";");

interface State {
	byId: Map<string, ParaSpacing>;
	set: DecorationSet;
}

// Only the groups and containers are walked, not the text inside the blocks
const decorate = (doc: Parameters<typeof DecorationSet.create>[0], byId: Map<string, ParaSpacing>) => {
	const decos: Decoration[] = [];
	doc.descendants((node, pos) => {
		const name = node.type.name;
		if (name === "blockContainer") {
			const s = byId.get(node.attrs.id as string);
			if (s) decos.push(Decoration.node(pos, pos + node.nodeSize, { class: s.toc ? "nx-sp nx-toc" : "nx-sp", style: style(s), ...(s.brk ? { "data-nx-brk": "1" } : {}), ...(s.valign ? { "data-nx-valign": s.valign } : {}), ...(s.keep ? { "data-nx-keep": "1" } : {}) }));
			return true;
		}
		return name === "doc" || name === "blockGroup";
	});
	return DecorationSet.create(doc, decos);
};

export const paragraphSpacingPlugin: Plugin<State> = new Plugin<State>({
	state: {
		init: () => ({ byId: new Map(), set: DecorationSet.empty }),
		apply(tr, value) {
			const added = tr.getMeta("paragraphSpacing") as Map<string, ParaSpacing> | undefined;
			if (added) {
				const byId = new Map(value.byId);
				added.forEach((s, id) => byId.set(id, s));
				return { byId, set: decorate(tr.doc, byId) };
			}
			if (!tr.docChanged) return value;
			// Blocks that arrive from someone else (or from the shared undo) may be ones the spacing is waiting for
			return tr.getMeta("y-sync$") && value.byId.size ? { byId: value.byId, set: decorate(tr.doc, value.byId) } : { byId: value.byId, set: value.set.map(tr.mapping, tr.doc) };
		},
	},
	props: {
		decorations: (state) => paragraphSpacingPlugin.getState(state)?.set ?? null,
	},
});

export function setParagraphSpacing(view: EditorView, added: Map<string, ParaSpacing>) {
	if (added.size) view.dispatch(view.state.tr.setMeta("paragraphSpacing", added).setMeta("addToHistory", false));
}
