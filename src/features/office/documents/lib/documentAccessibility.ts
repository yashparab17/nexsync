// What makes a document hard to use with a screen reader or without sight, found in the blocks of the editor: a picture with no description,
// headings that skip a level or say nothing, a table with no header row, a link whose text says nothing about where it goes, and blank
// paragraphs used as spacing. Each problem names the block it is in, so the editor can go there.

import type { BlockLike, Inline, LinkRun, Run, TableContent } from "@/features/office/documents/lib/documentFind";

export type ProblemKind = "picture" | "heading-order" | "heading-empty" | "table-header" | "link-text" | "blank-lines";

export interface Problem {
	kind: ProblemKind;
	blockId: string;
	message: string;
	how: string;
}

type Block = BlockLike & { props?: Record<string, unknown> };

// The names the editor gives a picture when nobody described it: nothing, a file name, or the kind of shape
const GENERIC_PICTURE = /^(image|picture|photo|graphic|screenshot|rect|round|ellipse|triangle|arrow|line)\s*\d*$/i;
const FILE_NAME = /\.(png|jpe?g|gif|webp|bmp|svg|tiff?)$/i;

export const hasDescription = (name: unknown): boolean => {
	const text = typeof name === "string" ? name.trim() : "";
	return text.length > 0 && !GENERIC_PICTURE.test(text) && !FILE_NAME.test(text);
};

// Link text that tells a person nothing when links are read out of the page one after the other
const VAGUE_LINK = /^(click here|here|this|link|this link|read more|more|learn more|see more|go)$/i;
const looksLikeUrl = (text: string) => /^(https?:\/\/|www\.)\S+$/i.test(text.trim());

const textOfRuns = (runs: Run[]) => runs.map((r) => r.text).join("");
const isLink = (i: Inline): i is LinkRun => i.type === "link";

function isBlank(b: Block): boolean {
	if (b.type !== "paragraph") return false;
	const content = Array.isArray(b.content) ? b.content : [];
	return content.every((c) => (isLink(c) ? textOfRuns(c.content) : c.text).trim() === "") && (b.children ?? []).length === 0;
}

function textOfBlock(b: Block): string {
	const content = Array.isArray(b.content) ? b.content : [];
	return content.map((c) => (isLink(c) ? textOfRuns(c.content) : c.text)).join("");
}

export function accessibilityProblems(blocks: BlockLike[]): Problem[] {
	const out: Problem[] = [];
	let lastLevel = 0;
	let blanks = 0;
	const walk = (list: Block[]) => {
		for (const b of list) {
			if (b.type === "image" && !hasDescription(b.props?.name)) {
				out.push({ kind: "picture", blockId: b.id, message: "A picture has no description.", how: "Select it and give it a description with Alt Text on the Insert tab." });
			}
			if (b.type === "heading") {
				const level = Number(b.props?.level ?? 1);
				if (textOfBlock(b).trim() === "") out.push({ kind: "heading-empty", blockId: b.id, message: "A heading has no text.", how: "Write the heading, or turn it into a plain paragraph." });
				else if (level > lastLevel + 1) out.push({ kind: "heading-order", blockId: b.id, message: `A heading skips from level ${lastLevel || "none"} to level ${level}: "${textOfBlock(b).trim().slice(0, 40)}".`, how: `Use level ${lastLevel + 1} here, so that someone moving by headings does not miss a part.` });
				if (textOfBlock(b).trim() !== "") lastLevel = level;
			}
			if (b.type === "table") {
				const table = b.content as TableContent & { headerRows?: number };
				if (!table?.headerRows) out.push({ kind: "table-header", blockId: b.id, message: "A table has no header row.", how: "Turn on Header Row in the table's design, so that each cell can be read with its column's name." });
			}
			if (Array.isArray(b.content)) {
				for (const c of b.content) {
					if (!isLink(c)) continue;
					const text = textOfRuns(c.content).trim();
					if (VAGUE_LINK.test(text) || looksLikeUrl(text)) out.push({ kind: "link-text", blockId: b.id, message: `A link reads "${text.slice(0, 40)}", which does not say where it goes.`, how: "Make the link text say what is at the other end." });
				}
			}
			// Two or more blank paragraphs in a row are spacing made with the Enter key
			if (isBlank(b)) {
				blanks++;
				if (blanks === 2) out.push({ kind: "blank-lines", blockId: b.id, message: "Blank paragraphs are used to make space.", how: "Use paragraph spacing or a page break instead; a screen reader reads each blank line as 'blank'." });
			} else blanks = 0;
			if (b.children?.length) walk(b.children as Block[]);
		}
	};
	walk(blocks as Block[]);
	return out;
}
