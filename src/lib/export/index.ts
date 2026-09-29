import { save } from "@tauri-apps/plugin-dialog";

import { isMarkdownFile } from "@/lib/editor/languages";
import { exportZip, uint8ArrayToBase64, writeExportFile } from "@/lib/tauri";
import { buildPdf } from "./pdf";

export type NoteFormat = "md" | "pdf";

const stem = (fileName: string) => fileName.replace(/\.[^.]+$/, "") || fileName;

// The save dialog can hand back a name without the extension that was asked for
const withExtension = (dest: string, ext: string) => (dest.toLowerCase().endsWith(`.${ext}`) ? dest : `${dest}.${ext}`);

// Saves a note as Markdown or PDF where the person chooses; resolves to that path, or null if they cancelled
export async function exportNote(workspacePath: string, fileName: string, text: string, format: NoteFormat): Promise<string | null> {
	const chosen = await save({
		title: format === "pdf" ? "Export note as PDF" : "Export note as Markdown",
		defaultPath: `${stem(fileName)}.${format}`,
		filters: [{ name: format === "pdf" ? "PDF document" : "Markdown", extensions: [format] }],
	});
	if (!chosen) return null;
	const dest = withExtension(chosen, format);
	const bytes = format === "pdf" ? buildPdf(stem(fileName), text, isMarkdownFile(fileName)) : new TextEncoder().encode(text);
	await writeExportFile(workspacePath, dest, uint8ArrayToBase64(bytes));
	return dest;
}

// Zips workspace folders where the person chooses; resolves to the path and the number of files, or null if cancelled
export async function exportFolders(
	workspacePath: string,
	roots: string[],
	suggestedName: string,
): Promise<{ dest: string; count: number } | null> {
	const chosen = await save({
		title: "Export as zip",
		defaultPath: `${suggestedName}.zip`,
		filters: [{ name: "Zip archive", extensions: ["zip"] }],
	});
	if (!chosen) return null;
	const dest = withExtension(chosen, "zip");
	return { dest, count: await exportZip(workspacePath, roots, dest) };
}
