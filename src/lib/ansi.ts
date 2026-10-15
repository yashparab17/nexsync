// Program output with colour codes, as pieces of text with the look each piece asked for. Colours use the theme's own, so the
// output reads in light and dark; cursor movement and other codes are dropped.

export interface Piece {
	text: string;
	className: string;
}

const COLOURS: Record<number, string> = { 30: "text-muted-foreground", 31: "text-destructive", 32: "text-success", 33: "text-warning", 34: "text-primary", 35: "text-primary", 36: "text-primary", 37: "text-foreground" };

export function ansiPieces(line: string): Piece[] {
	const out: Piece[] = [];
	let colour = "";
	let bold = false;
	let dim = false;
	let at = 0;
	const push = (text: string) => text && out.push({ text, className: [colour, bold ? "font-semibold" : "", dim ? "opacity-60" : ""].filter(Boolean).join(" ") });
	// eslint-disable-next-line no-control-regex
	for (const m of line.matchAll(/\u001b\[([0-9;?]*)([ -/]*[@-~])/g)) {
		push(line.slice(at, m.index));
		at = (m.index ?? 0) + m[0].length;
		if (m[2] !== "m") continue;
		for (const code of (m[1] || "0").split(";").map(Number)) {
			if (code === 0) [colour, bold, dim] = ["", false, false];
			else if (code === 1) bold = true;
			else if (code === 2) dim = true;
			else if (code === 22) [bold, dim] = [false, false];
			else if (code === 39) colour = "";
			else if (COLOURS[code]) colour = COLOURS[code];
			else if (COLOURS[code - 60]) colour = COLOURS[code - 60];
		}
	}
	push(line.slice(at));
	return out;
}

export const plain = (line: string) => ansiPieces(line).map((p) => p.text).join("");
