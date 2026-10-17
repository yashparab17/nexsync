// A workspace's icon: a picture, or an emoji on a colour. The Owner and Admins set it as a signed entry of the log, so every
// member's device shows the same one; each device also keeps a copy in the browser's storage under the workspace's id, which
// is what the Welcome screen reads for workspaces that are not open.

import type { LogEntry } from "@/features/chat/lib/entries";
import { PALETTE } from "@/lib/collabColor";


// A picture; an emoji on a colour (the name's own when none is chosen); or the first letter of the name on a chosen colour
export type WorkspaceIcon = { kind: "image"; data: string } | { kind: "glyph"; glyph: string; color?: string } | { kind: "letter"; color: string };

export const GLYPHS = ["📓", "🧪", "🚀", "💡", "🎯", "📚", "🛠️", "🌱", "🎨", "🔬", "🧩", "⚡"];
// A picture is drawn at 96 pixels (64 if it is still too big), so that it fits in one entry of the log
export const ICON_PIXELS = 96;
const MAX_DATA = 18_000;

const key = (id: string) => `nexsync-icon:${id}`;

export function parseIcon(text: string | null): WorkspaceIcon | null {
	if (!text) return null;
	try {
		const v = JSON.parse(text) as Partial<WorkspaceIcon> & Record<string, unknown>;
		if (v.kind === "image" && typeof v.data === "string" && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v.data) && v.data.length <= MAX_DATA) return { kind: "image", data: v.data };
		const color = typeof v.color === "string" && PALETTE.includes(v.color.toLowerCase()) ? v.color.toLowerCase() : undefined;
		if (v.kind === "glyph" && typeof v.glyph === "string" && [...v.glyph].length >= 1 && [...v.glyph].length <= 2) return color ? { kind: "glyph", glyph: v.glyph, color } : { kind: "glyph", glyph: v.glyph };
		if (v.kind === "letter" && color) return { kind: "letter", color };
	} catch {
		/* not an icon */
	}
	return null;
}

export function getIcon(id: string): WorkspaceIcon | null {
	try {
		return parseIcon(localStorage.getItem(key(id)));
	} catch {
		return null;
	}
}

export function setIcon(id: string, icon: WorkspaceIcon | null): void {
	try {
		if (icon) localStorage.setItem(key(id), JSON.stringify(icon));
		else localStorage.removeItem(key(id));
		window.dispatchEvent(new CustomEvent("nexsync-icon", { detail: id }));
	} catch {
		/* blocked storage: the workspace keeps its letter */
	}
}

// The icon the newest "icon" entry sets: an icon, `null` when it was cleared, or `undefined` when none was ever set
export function iconFromEntries(entries: LogEntry[]): WorkspaceIcon | null | undefined {
	let newest: LogEntry | null = null;
	for (const e of entries) if (e.kind === "icon" && (!newest || e.ts >= newest.ts)) newest = e;
	return newest ? parseIcon(newest.body) : undefined;
}

// A picture cropped to a square from its middle and drawn small, as a data address that fits one entry of the log
export async function pictureToIcon(file: Blob): Promise<WorkspaceIcon> {
	const bitmap = await createImageBitmap(file);
	const side = Math.min(bitmap.width, bitmap.height);
	try {
		for (const pixels of [ICON_PIXELS, 64]) {
			const canvas = document.createElement("canvas");
			canvas.width = canvas.height = pixels;
			const ctx = canvas.getContext("2d");
			if (!ctx) throw new Error("This picture could not be read.");
			ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, pixels, pixels);
			for (const [type, quality] of [["image/webp", 0.8], ["image/png", undefined]] as const) {
				const data = canvas.toDataURL(type, quality);
				if (data.startsWith(`data:${type}`) && data.length <= MAX_DATA) return { kind: "image", data };
			}
		}
	} finally {
		bitmap.close();
	}
	throw new Error("This picture is too detailed to keep as an icon. Try a simpler one.");
}
