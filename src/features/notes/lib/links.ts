// [[Wiki links]] between notes, backlinks and the heading outline of a Markdown note

export interface NoteRef {
	path: string;
	name: string;
}

export interface Heading {
	level: number;
	text: string;
	line: number; // 1-based, as the editor numbers lines
}

// A note's title is its file name without the extension
export const noteTitle = (name: string) => name.replace(/\.[^./]+$/, "");

// Text with fenced and inline code blanked out, so `[[not a link]]` in code is ignored. Line breaks are kept
// so line numbers still match.
function withoutCode(text: string): string {
	const lines = text.replace(/\r\n/g, "\n").split("\n");
	let fence: string | null = null;
	return lines
		.map((line) => {
			const mark = /^\s*(```|~~~)/.exec(line)?.[1];
			if (fence) {
				if (mark === fence) fence = null;
				return "";
			}
			if (mark) {
				fence = mark;
				return "";
			}
			return line.replace(/`[^`]*`/g, (m) => " ".repeat(m.length));
		})
		.join("\n");
}

const LINK = /\[\[([^\]\n|]+)(?:\|[^\]\n]*)?\]\]/g;

// The notes a text links to, in order of first mention: [[Target]] or [[Target|shown text]]
export function extractLinks(text: string): string[] {
	const targets: string[] = [];
	for (const match of withoutCode(text).matchAll(LINK)) {
		const target = match[1].trim();
		if (target && !targets.some((t) => t.toLowerCase() === target.toLowerCase())) targets.push(target);
	}
	return targets;
}

// The note a link points at: its title or file name, ignoring case
export function resolveLink(target: string, notes: NoteRef[]): NoteRef | undefined {
	const wanted = target.trim().toLowerCase();
	return notes.find((n) => noteTitle(n.name).toLowerCase() === wanted) ?? notes.find((n) => n.name.toLowerCase() === wanted);
}

// The notes (other than `self`) that link to `self`
export function findBacklinks(self: NoteRef, others: { note: NoteRef; text: string }[]): NoteRef[] {
	return others
		.filter(({ note, text }) => note.path !== self.path && extractLinks(text).some((t) => resolveLink(t, [self]) !== undefined))
		.map(({ note }) => note);
}

// Headings written as "# Title" through "###### Title", outside code
export function extractHeadings(text: string): Heading[] {
	const headings: Heading[] = [];
	withoutCode(text)
		.split("\n")
		.forEach((line, i) => {
			const match = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
			if (match) headings.push({ level: match[1].length, text: match[2], line: i + 1 });
		});
	return headings;
}

// The link target under `offset` in one line of text, or null
export function linkAt(line: string, offset: number): string | null {
	for (const match of line.matchAll(LINK)) {
		const start = match.index ?? 0;
		if (offset >= start && offset <= start + match[0].length) return match[1].trim();
	}
	return null;
}
