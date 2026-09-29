// A small PDF writer for notes: headings, paragraphs, lists, quotes and code, laid out on A4 pages with the
// standard PDF fonts. Those fonts cover Western European text; other scripts are written as "?".

type Kind = "h1" | "h2" | "h3" | "p" | "li" | "quote" | "code" | "rule" | "gap";

export interface Block {
	kind: Kind;
	text: string;
	// The bullet or number in front of a list item
	marker?: string;
}

const PAGE = { width: 595, height: 842, margin: 56 };

// Widths of the printable ASCII characters (32 to 126) in Helvetica, in 1/1000 of the font size
const HELVETICA = [
	278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
	278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667,
	611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833,
	556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

type Font = "F1" | "F2" | "F3";

// Characters outside Latin-1 that WinAnsi still has, by their byte
const WIN_ANSI: Record<string, number> = {
	"€": 0x80, "‚": 0x82, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87, "‰": 0x89, "‹": 0x8b, "‘": 0x91, "’": 0x92,
	"“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "™": 0x99, "›": 0x9b,
};

// The bytes a piece of text becomes in the PDF: accents are dropped where WinAnsi lacks the letter
export function encode(text: string): number[] {
	const bytes: number[] = [];
	for (const char of text.replace(/\t/g, "    ")) {
		const code = char.codePointAt(0)!;
		if (code >= 32 && code < 127) bytes.push(code);
		else if (code >= 0xa0 && code <= 0xff) bytes.push(code);
		else if (WIN_ANSI[char] !== undefined) bytes.push(WIN_ANSI[char]);
		else {
			const plain = char.normalize("NFKD").replace(/[̀-ͯ]/g, "");
			bytes.push(plain.length === 1 && plain.charCodeAt(0) >= 32 && plain.charCodeAt(0) < 127 ? plain.charCodeAt(0) : 63);
		}
	}
	return bytes;
}

function width(bytes: number[], font: Font, size: number): number {
	if (font === "F3") return bytes.length * 0.6 * size;
	const total = bytes.reduce((sum, b) => sum + (b >= 32 && b < 127 ? HELVETICA[b - 32] : 556), 0);
	return (total / 1000) * size * (font === "F2" ? 1.06 : 1);
}

// Breaks a line into pieces that each fit `max`, at spaces where it can and inside long words where it cannot
export function wrap(text: string, font: Font, size: number, max: number): string[] {
	const lines: string[] = [];
	let line = "";
	const fits = (s: string) => width(encode(s), font, size) <= max;
	for (const word of text.replace(/\t/g, "    ").split(/(?<= )/)) {
		if (fits(line + word) || line === "") {
			line += word;
		} else {
			lines.push(line.trimEnd());
			line = word;
		}
		while (!fits(line) && line.length > 1) {
			let cut = line.length - 1;
			while (cut > 1 && !fits(line.slice(0, cut))) cut--;
			lines.push(line.slice(0, cut));
			line = line.slice(cut);
		}
	}
	lines.push(line.trimEnd());
	return lines;
}

// Marks that only matter in Markdown source
function stripInline(text: string): string {
	return text
		.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
		.replace(/(\*\*|__)(.+?)\1/g, "$2")
		.replace(/(\*|_)(\S(?:.*?\S)?)\1/g, "$2")
		.replace(/`([^`]+)`/g, "$1")
		.replace(/<[^>]+>/g, "");
}

// The blocks of a note. Markdown is read for headings, lists, quotes and code; plain text keeps its lines.
export function parseBlocks(text: string, markdown: boolean): Block[] {
	const lines = text.replace(/\r\n/g, "\n").split("\n");
	if (lines[lines.length - 1] === "") lines.pop();
	if (!markdown) return lines.map((line) => (line.trim() === "" ? { kind: "gap", text: "" } : { kind: "p", text: line }));

	const blocks: Block[] = [];
	let fenced = false;
	let paragraph: string[] = [];
	const flush = () => {
		if (paragraph.length) blocks.push({ kind: "p", text: stripInline(paragraph.join(" ")) });
		paragraph = [];
	};
	for (const line of lines) {
		if (/^\s*(```|~~~)/.test(line)) {
			flush();
			fenced = !fenced;
			continue;
		}
		if (fenced) {
			blocks.push({ kind: "code", text: line });
			continue;
		}
		const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
		const item = /^(\s*)([-*+]|\d+[.)])\s+(?:\[( |x|X)\]\s+)?(.*)$/.exec(line);
		if (line.trim() === "") {
			flush();
			blocks.push({ kind: "gap", text: "" });
		} else if (heading) {
			flush();
			blocks.push({ kind: (["h1", "h2", "h3"] as const)[Math.min(heading[1].length, 3) - 1], text: stripInline(heading[2]) });
		} else if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
			flush();
			blocks.push({ kind: "rule", text: "" });
		} else if (item) {
			flush();
			const task = item[3] === undefined ? "" : item[3] === " " ? "[ ] " : "[x] ";
			const bullet = /\d/.test(item[2]) ? item[2] : "•";
			blocks.push({ kind: "li", marker: `${" ".repeat(Math.floor(item[1].length / 2))}${bullet}`, text: task + stripInline(item[4]) });
		} else if (/^\s*>/.test(line)) {
			flush();
			blocks.push({ kind: "quote", text: stripInline(line.replace(/^\s*>\s?/, "")) });
		} else {
			paragraph.push(line.trim());
		}
	}
	flush();
	return blocks;
}

interface Placed {
	font: Font;
	size: number;
	x: number;
	y: number;
	text: string;
}

const STYLE: Record<Kind, { font: Font; size: number; leading: number; before: number }> = {
	h1: { font: "F2", size: 20, leading: 26, before: 10 },
	h2: { font: "F2", size: 16, leading: 21, before: 8 },
	h3: { font: "F2", size: 13, leading: 18, before: 6 },
	p: { font: "F1", size: 11, leading: 15, before: 0 },
	li: { font: "F1", size: 11, leading: 15, before: 0 },
	quote: { font: "F1", size: 11, leading: 15, before: 0 },
	code: { font: "F3", size: 9.5, leading: 12.5, before: 0 },
	rule: { font: "F1", size: 11, leading: 10, before: 0 },
	gap: { font: "F1", size: 11, leading: 8, before: 0 },
};

// Puts the blocks on pages; each page is a list of text lines with their positions and rules to draw
function layout(blocks: Block[]): { text: Placed[]; rules: number[] }[] {
	const pages: { text: Placed[]; rules: number[] }[] = [{ text: [], rules: [] }];
	let y = PAGE.height - PAGE.margin;
	const bottom = PAGE.margin + 14;
	const room = (needed: number) => {
		if (y - needed < bottom) {
			pages.push({ text: [], rules: [] });
			y = PAGE.height - PAGE.margin;
		}
	};
	const content = PAGE.width - PAGE.margin * 2;

	for (const block of blocks) {
		const style = STYLE[block.kind];
		if (block.kind === "gap") {
			y -= style.leading;
			continue;
		}
		if (block.kind === "rule") {
			room(style.leading);
			y -= style.leading / 2;
			pages[pages.length - 1].rules.push(y);
			y -= style.leading / 2;
			continue;
		}
		const indent = block.kind === "li" ? 18 + (block.marker?.match(/^ */)?.[0].length ?? 0) * 12 : block.kind === "quote" ? 14 : 0;
		const lines = wrap(block.text, style.font, style.size, content - indent);
		// A heading is not left alone at the bottom of a page
		room(style.before + style.leading * (block.kind.startsWith("h") ? 2 : 1));
		y -= style.before;
		lines.forEach((line, index) => {
			room(style.leading);
			y -= style.leading;
			const page = pages[pages.length - 1];
			if (index === 0 && block.marker) {
				page.text.push({ font: "F1", size: style.size, x: PAGE.margin + indent - 16, y, text: block.marker.trimStart() });
			}
			page.text.push({ font: style.font, size: style.size, x: PAGE.margin + indent, y, text: line });
		});
		if (block.kind === "p" || block.kind === "li" || block.kind === "quote") y -= 3;
	}
	return pages;
}

// A PDF string holding only ASCII characters: anything else is written as an octal escape
function pdfString(bytes: number[]): string {
	return `(${bytes
		.map((b) => (b === 40 || b === 41 || b === 92 ? `\\${String.fromCharCode(b)}` : b >= 32 && b < 127 ? String.fromCharCode(b) : `\\${b.toString(8).padStart(3, "0")}`))
		.join("")})`;
}

const num = (n: number) => (Math.round(n * 100) / 100).toString();

export function buildPdf(title: string, text: string, markdown: boolean): Uint8Array {
	const pages = layout(parseBlocks(text, markdown));
	const objects: string[] = [];
	const add = (body: string) => objects.push(body);

	add("<< /Type /Catalog /Pages 2 0 R >>");
	add("PAGES"); // filled in once the page objects are known
	add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
	add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
	add("<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>");
	const info = add(`<< /Title ${pdfString(encode(title))} /Producer (Nexsync) >>`);

	const pageIds: number[] = [];
	pages.forEach((page, index) => {
		const footer = `${index + 1} / ${pages.length}`;
		const ops = [
			...page.rules.map((y) => `0.75 G 0.5 w ${PAGE.margin} ${num(y)} m ${PAGE.width - PAGE.margin} ${num(y)} l S`),
			...page.text.map((t) => `BT /${t.font} ${t.size} Tf 1 0 0 1 ${num(t.x)} ${num(t.y)} Tm ${pdfString(encode(t.text))} Tj ET`),
			`BT /F1 9 Tf 0.5 g 1 0 0 1 ${num(PAGE.width / 2 - width(encode(footer), "F1", 9) / 2)} ${PAGE.margin - 24} Tm ${pdfString(encode(footer))} Tj ET`,
		].join("\n");
		const stream = add(`<< /Length ${ops.length} >>\nstream\n${ops}\nendstream`);
		pageIds.push(
			add(
				`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Contents ${stream} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> >>`,
			),
		);
	});
	objects[1] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`;

	// Every character is ASCII, so a string's length is its length in bytes and the offsets below are exact
	let out = "%PDF-1.4\n";
	const offsets = objects.map((body, index) => {
		const at = out.length;
		out += `${index + 1} 0 obj\n${body}\nendobj\n`;
		return at;
	});
	const xref = out.length;
	out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${o.toString().padStart(10, "0")} 00000 n \n`).join("")}`;
	out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return new TextEncoder().encode(out);
}
