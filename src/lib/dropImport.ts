// Files and folders dropped from the desktop, and saving them into a workspace folder.

import { readFileBase64 } from "@/lib/assets/uploadScale";
import { listWorkspaceFiles, writeWorkspaceBinaryFile } from "@/lib/tauri";
import { safeUploadName } from "@/lib/validation";

export interface DroppedFile {
	file: File;
	// Where it sits inside what was dropped: `a.txt`, or `photos/a.png` when a folder came along
	rel: string;
}

type Entry = { isFile: boolean; isDirectory: boolean; name: string; file?: (ok: (f: File) => void, err: (e: unknown) => void) => void; createReader?: () => { readEntries: (ok: (e: Entry[]) => void, err: (e: unknown) => void) => void } };

async function walk(entry: Entry, base: string, out: DroppedFile[]) {
	if (entry.isFile && entry.file) {
		const file = await new Promise<File>((ok, err) => entry.file!(ok, err));
		out.push({ file, rel: base + entry.name });
	} else if (entry.isDirectory && entry.createReader) {
		const reader = entry.createReader();
		// readEntries hands back at most a batch at a time, until it returns none
		for (;;) {
			const batch = await new Promise<Entry[]>((ok, err) => reader.readEntries(ok, err));
			if (batch.length === 0) break;
			for (const child of batch) await walk(child, `${base}${entry.name}/`, out);
		}
	}
}

// Everything in a drop, folders included. The entries must be taken before the first await: the browser empties the
// drop as soon as the event handler returns.
export async function readDrop(dt: DataTransfer): Promise<DroppedFile[]> {
	const entries = Array.from(dt.items ?? [])
		.filter((i) => i.kind === "file")
		.map((i) => (i as DataTransferItem & { webkitGetAsEntry?: () => Entry | null }).webkitGetAsEntry?.() ?? null);
	const files = Array.from(dt.files ?? []);
	const out: DroppedFile[] = [];
	if (entries.length > 0 && entries.every(Boolean)) {
		for (const e of entries) await walk(e!, "", out);
	} else {
		for (const file of files) out.push({ file, rel: file.name });
	}
	return out;
}

// Whether a drag carries files from outside the app, not a tab or card being moved inside it
export const carriesFiles = (dt: DataTransfer | null) => !!dt && Array.from(dt.types ?? []).includes("Files");

export interface ImportResult {
	saved: number;
	failed: { name: string; error: string }[];
}

// Saves dropped files under `dir`. A name already taken at the top level gets " (2)", so nothing is overwritten.
export async function importDropped(workspacePath: string, dir: string, items: DroppedFile[]): Promise<ImportResult> {
	const taken = new Set((await listWorkspaceFiles(workspacePath, dir).catch(() => [])).map((e) => e.name.toLowerCase()));
	const renamed = new Map<string, string>();
	const top = (name: string) => {
		const safe = safeUploadName(name);
		const done = renamed.get(safe);
		if (done) return done;
		let next = safe;
		const dot = safe.lastIndexOf(".");
		const [stem, ext] = dot > 0 ? [safe.slice(0, dot), safe.slice(dot)] : [safe, ""];
		for (let n = 2; taken.has(next.toLowerCase()); n++) next = `${stem} (${n})${ext}`;
		taken.add(next.toLowerCase());
		renamed.set(safe, next);
		return next;
	};
	const result: ImportResult = { saved: 0, failed: [] };
	for (const { file, rel } of items) {
		try {
			const [first, ...rest] = rel.split("/");
			const path = [dir, top(first), ...rest.map((s) => safeUploadName(s))].filter(Boolean).join("/");
			await writeWorkspaceBinaryFile(workspacePath, path, await readFileBase64(file));
			result.saved++;
		} catch (err) {
			result.failed.push({ name: rel, error: err instanceof Error ? err.message : String(err) });
		}
	}
	return result;
}

export const dropSummary = (r: ImportResult) =>
	r.failed.length === 0
		? `Added ${r.saved} ${r.saved === 1 ? "file" : "files"}.`
		: `Added ${r.saved}; ${r.failed.length} failed: ${r.failed[0].name} (${r.failed[0].error}).`;
