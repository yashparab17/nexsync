// A dropped folder holds all sorts of files. Sorting sends each to where the workspace keeps that kind: pictures, sound, video and PDFs to
// Assets, Word files to Documents, spreadsheets to Sheets, decks to Slides, Markdown and text to Notes, and the rest to Others, in the
// folders they came in.

import { importDropped, type DroppedFile, type ImportResult } from "@/lib/dropImport";
import { LAYOUT } from "@/lib/workspaceLayout";

export type Place = "assets" | "documents" | "sheets" | "slides" | "notes" | "others";

const KINDS: Record<Exclude<Place, "others">, string[]> = {
	assets: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "ico", "tif", "tiff", "heic", "mp3", "wav", "ogg", "flac", "m4a", "aac", "opus", "mp4", "m4v", "mov", "webm", "mkv", "avi", "pdf", "ttf", "otf", "woff", "woff2"],
	documents: ["docx", "docm", "dotx", "dotm", "doc", "dot", "odt", "rtf"],
	sheets: ["xlsx", "xlsm", "xls", "ods", "csv", "tsv"],
	slides: ["pptx", "ppt", "odp"],
	notes: ["md", "markdown", "txt"],
};

const FOLDER: Record<Place, string> = { assets: LAYOUT.assets, documents: LAYOUT.documents, sheets: LAYOUT.sheets, slides: LAYOUT.slides, notes: LAYOUT.notes, others: LAYOUT.others };
export const PLACE_NAME: Record<Place, string> = { assets: "Assets", documents: "Documents", sheets: "Sheets", slides: "Slides", notes: "Notes", others: "Others" };

const BY_EXT = new Map<string, Place>(Object.entries(KINDS).flatMap(([place, exts]) => exts.map((e) => [e, place as Place] as const)));

// Files the system leaves in folders, which nobody meant to add
const JUNK = /^(\.|thumbs\.db$|desktop\.ini$)/i;
const isJunk = (rel: string) => rel.split("/").some((part) => JUNK.test(part));

export const placeOf = (name: string): Place => BY_EXT.get(name.split(".").pop()?.toLowerCase() ?? "") ?? "others";

export interface SortResult {
	// How many went to each place
	placed: Partial<Record<Place, number>>;
	skipped: number;
	failed: ImportResult["failed"];
}

// Saves a drop, each file where its kind belongs. Only Others keeps the folders; the other places are flat, so two files with the
// same name from different folders both stay (the second becomes "name (2)").
export async function importSorted(workspacePath: string, items: DroppedFile[]): Promise<SortResult> {
	const wanted = items.filter((i) => !isJunk(i.rel));
	const groups = new Map<Place, DroppedFile[]>();
	for (const item of wanted) {
		const place = placeOf(item.file.name);
		groups.set(place, [...(groups.get(place) ?? []), place === "others" ? item : { ...item, rel: item.file.name }]);
	}
	const out: SortResult = { placed: {}, skipped: items.length - wanted.length, failed: [] };
	for (const [place, list] of groups) {
		const result = await importDropped(workspacePath, FOLDER[place], list, place !== "others");
		if (result.saved > 0) out.placed[place] = result.saved;
		out.failed.push(...result.failed);
	}
	return out;
}

export function sortSummary(r: SortResult): string {
	const parts = (Object.keys(PLACE_NAME) as Place[]).filter((p) => r.placed[p]).map((p) => `${r.placed[p]} to ${PLACE_NAME[p]}`);
	const head = parts.length === 0 ? "Nothing was added." : `Added ${parts.join(", ")}.`;
	return r.failed.length === 0 ? head : `${head} ${r.failed.length} failed: ${r.failed[0].name} (${r.failed[0].error}).`;
}

// A drop that holds a folder is sorted; single files dropped on a page go where that page keeps them
export const hasFolder = (items: DroppedFile[]) => items.some((i) => i.rel.includes("/"));
