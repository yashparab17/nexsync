import { useEffect, useState } from "react";

import { isBinaryFile, isDocumentFile } from "@/lib/editor/languages";
import { baseName } from "@/lib/editor/fileKinds";
import { readWorkspaceFile } from "@/lib/tauri";

// What the finder shows for the highlighted file: its first lines, read once and kept for the session
const cache = new Map<string, string>();
const LINES = 80;

export default function FilePreview({ workspacePath, path }: { workspacePath: string; path: string }) {
	const key = `${workspacePath}:${path}`;
	const [text, setText] = useState<string | null>(cache.get(key) ?? null);

	useEffect(() => {
		const name = baseName(path);
		if (isBinaryFile(name) || isDocumentFile(name)) {
			setText("");
			return;
		}
		const hit = cache.get(key);
		if (hit !== undefined) {
			setText(hit);
			return;
		}
		setText(null);
		let live = true;
		// A short wait, so moving quickly down the list does not read every file on the way
		const timer = setTimeout(() => {
			readWorkspaceFile(workspacePath, path)
				.then((raw) => {
					const head = raw.split("\n").slice(0, LINES).join("\n");
					cache.set(key, head);
					if (live) setText(head);
				})
				.catch(() => live && setText(""));
		}, 120);
		return () => {
			live = false;
			clearTimeout(timer);
		};
	}, [workspacePath, path, key]);

	if (text === null) return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
	if (text === "") return <p className="p-4 text-sm text-muted-foreground">No preview.</p>;
	const lines = text.split("\n");
	return (
		<pre aria-label={`Preview of ${baseName(path)}`} className="h-full overflow-auto p-3 font-mono text-xs leading-5">
			{lines.map((line, i) => (
				<div key={i} className="flex gap-3">
					<span className="w-8 shrink-0 text-right text-muted-foreground tabular-nums select-none">{i + 1}</span>
					<span className="whitespace-pre">{line || " "}</span>
				</div>
			))}
		</pre>
	);
}
