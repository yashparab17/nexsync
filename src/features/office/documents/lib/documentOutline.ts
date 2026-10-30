// A document as plain data, for a person, a script or an agent that cannot (or should not have to) look at the page: its headings, tables,
// pictures and links, how much text there is, who changed what (when the caller has the tracked changes and comments), and what the
// accessibility check finds. It is a reading of the editor's blocks and changes nothing.

import { accessibilityProblems, hasDescription, type Problem } from "@/features/office/documents/lib/documentAccessibility";
import { headingsOf, textOfBlocks, type BlockLike, type Inline, type LinkRun, type TableContent } from "@/features/office/documents/lib/documentFind";

export interface Outline {
	words: number;
	paragraphs: number;
	headings: { id: string; level: number; text: string }[];
	tables: { id: string; rows: number; columns: number; headerRows: number }[];
	pictures: { id: string; description: string | null }[];
	links: { text: string; href: string }[];
	trackedChanges: { kind: string; author: string; date: string; text: string }[];
	comments: { author: string; text: string; resolved: boolean }[];
	accessibility: Problem[];
}

export interface OutlineExtras {
	trackedChanges?: Outline["trackedChanges"];
	comments?: Outline["comments"];
}

const isLink = (i: Inline): i is LinkRun => i.type === "link";

export function documentOutline(blocks: BlockLike[], extras: OutlineExtras = {}): Outline {
	const tables: Outline["tables"] = [];
	const pictures: Outline["pictures"] = [];
	const links: Outline["links"] = [];
	let paragraphs = 0;
	const walk = (list: (BlockLike & { props?: Record<string, unknown> })[]) => {
		for (const b of list) {
			if (b.type === "table" && b.content && !Array.isArray(b.content)) {
				const t = b.content as TableContent & { headerRows?: number };
				tables.push({ id: b.id, rows: t.rows.length, columns: Math.max(0, ...t.rows.map((r) => r.cells.length)), headerRows: t.headerRows ?? 0 });
			} else if (b.type === "image") {
				pictures.push({ id: b.id, description: hasDescription(b.props?.name) ? String(b.props?.name).trim() : null });
			} else if (Array.isArray(b.content)) {
				if (b.type !== "heading" && textOfBlocks([{ ...b, children: [] }]).trim() !== "") paragraphs++;
				for (const c of b.content) if (isLink(c)) links.push({ text: c.content.map((r) => r.text).join(""), href: c.href });
			}
			if (b.children?.length) walk(b.children as (BlockLike & { props?: Record<string, unknown> })[]);
		}
	};
	walk(blocks);
	const text = textOfBlocks(blocks).trim();
	return {
		words: text ? text.split(/\s+/).length : 0,
		paragraphs,
		headings: headingsOf(blocks),
		tables,
		pictures,
		links,
		trackedChanges: extras.trackedChanges ?? [],
		comments: extras.comments ?? [],
		accessibility: accessibilityProblems(blocks),
	};
}
