// Turning note text into counts, and plain text into and out of rich-text blocks

export interface TextStats {
	lines: number;
	words: number;
	chars: number;
}

// A word is a run of letters or digits, and may contain an apostrophe or hyphen (don't, well-known)
const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;

// Counts what a person sees. A trailing line break does not add a line, and an empty note has no lines.
export function textStats(text: string): TextStats {
	const clean = text.replace(/\r\n/g, "\n");
	const lines = clean === "" ? 0 : clean.replace(/\n$/, "").split("\n").length;
	return { lines, words: (clean.match(WORD) ?? []).length, chars: clean.length };
}

// The words of a Markdown note without its markup, so "## Title" is one word and "[docs](https://x.y)" is one word
export function markdownToPlain(markdown: string): string {
	return markdown
		.replace(/\r\n/g, "\n")
		.replace(/^\s*(```|~~~).*$/gm, "") // fence lines; the code between them still counts
		.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // images keep their alt text
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links keep their text
		.replace(/<\/?[A-Za-z][^>]*>/g, "") // html tags
		.replace(/^\s{0,3}#{1,6}\s+/gm, "") // headings
		.replace(/^\s*>+\s?/gm, "") // quotes
		.replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/gm, "") // list and task markers
		.replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, "") // rules
		.replace(/[*_~`]+/g, ""); // emphasis and inline code marks
}

// Stats for a Markdown note: lines as the editor numbers them, words without the markup
export function markdownStats(markdown: string): TextStats {
	return { ...textStats(markdown), words: textStats(markdownToPlain(markdown)).words };
}

// The parts of a rich-text block this file reads, so it does not depend on the editor library's types
interface RichBlock {
	type: string;
	props?: { level?: number };
	content?: unknown;
	children?: RichBlock[];
}

interface Inline {
	type?: string;
	text?: string;
	content?: Inline[];
}

function inlineText(content: unknown): string {
	if (!Array.isArray(content)) return "";
	return (content as Inline[])
		.map((part) => (typeof part.text === "string" ? part.text : inlineText(part.content)))
		.join("");
}

// Plain text of a rich-text document: one line per block, with list markers written out so lists stay readable
export function blocksToPlainText(blocks: RichBlock[]): string {
	const lines: string[] = [];
	const walk = (list: RichBlock[], depth: number) => {
		let number = 0;
		for (const block of list) {
			const text = inlineText(block.content);
			number = block.type === "numberedListItem" ? number + 1 : 0;
			const marker =
				block.type === "heading" ? "#".repeat(Math.min(Math.max(block.props?.level ?? 1, 1), 3)) + " " :
				block.type === "bulletListItem" ? "- "
				: block.type === "numberedListItem" ? `${number}. `
				: block.type === "checkListItem" ? "[ ] "
				: "";
			lines.push("  ".repeat(depth) + marker + text);
			if (block.children?.length) walk(block.children, depth + 1);
		}
	};
	walk(blocks, 0);
	// The editor always keeps one empty block at the end, which is not a line of the note
	while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
	return lines.length === 0 ? "" : lines.join("\n") + "\n";
}

// Rich-text blocks for plain text: one paragraph per line, and a line starting with "# ", "## " or "### " is a heading
export function plainTextToBlocks(text: string) {
	const lines = text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
	return lines.map((line) => {
		const heading = /^(#{1,3}) +(.+)$/.exec(line);
		const shown = heading ? heading[2] : line;
		const content = shown === "" ? [] : [{ type: "text" as const, text: shown, styles: {} }];
		return heading
			? { type: "heading" as const, props: { level: heading[1].length as 1 | 2 | 3 }, content }
			: { type: "paragraph" as const, content };
	});
}
