import { useCallback, useEffect, useMemo, useState } from "react";
import { History, Loader2, RotateCcw, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { diffLines, type DiffResult, type DiffRow } from "@/lib/diff";
import { isBinaryFile, isDocumentFile } from "@/lib/editor/languages";
import { listFileVersions, readFileVersion, readWorkspaceFile, recordFileVersion, restoreFileVersion } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import type { FileVersion } from "@/types/workspace";
import Loading from "@/components/Loading";

const SOURCES: Record<string, string> = {
	save: "Saved",
	sync: "From a collaborator",
	import: "Imported",
	auto: "Auto-saved",
	named: "Named",
	restore: "Restored",
	"before-restore": "Before a restore",
};

const CONTEXT = 3;

const formatSize = (bytes: number) => (bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

type Shown = DiffRow | { gap: number };

// Long stretches of unchanged lines are folded away, leaving a few lines around each change
function fold(rows: DiffRow[]): Shown[] {
	const near = rows.map((row, i) => row.kind !== "same" || rows.slice(Math.max(0, i - CONTEXT), i + CONTEXT + 1).some((r) => r.kind !== "same"));
	const shown: Shown[] = [];
	let hidden = 0;
	rows.forEach((row, i) => {
		if (near[i]) {
			if (hidden) shown.push({ gap: hidden });
			hidden = 0;
			shown.push(row);
		} else hidden++;
	});
	if (hidden) shown.push({ gap: hidden });
	return shown;
}

function DiffView({ diff }: { diff: DiffResult }) {
	const shown = useMemo(() => fold(diff.rows), [diff]);
	if (diff.identical) return <p className="p-4 text-xs text-muted-foreground">No differences.</p>;
	return (
		<div className="font-mono text-xs" role="table" aria-label="Changes">
			{diff.tooLarge && (
				<p className="border-b bg-amber-500/10 p-2 text-amber-400">Too large to compare line by line, so everything in the middle is shown as changed.</p>
			)}
			{shown.map((row, index) =>
				"gap" in row ? (
					<div key={`gap-${index}`} className="bg-muted/30 px-3 py-0.5 text-center text-[11px] text-muted-foreground">
						{row.gap} unchanged {row.gap === 1 ? "line" : "lines"}
					</div>
				) : (
					<div
						key={`${row.oldLine ?? ""}-${row.newLine ?? ""}-${row.kind}`}
						role="row"
						className={cn("flex", row.kind === "add" && "bg-emerald-500/10", row.kind === "del" && "bg-red-500/10")}
					>
						<span className="w-10 shrink-0 select-none px-1 text-right text-muted-foreground/60">{row.oldLine ?? ""}</span>
						<span className="w-10 shrink-0 select-none px-1 text-right text-muted-foreground/60">{row.newLine ?? ""}</span>
						<span className="w-4 shrink-0 select-none text-center text-muted-foreground">{row.kind === "add" ? "+" : row.kind === "del" ? "-" : ""}</span>
						<span className="min-w-0 flex-1 whitespace-pre-wrap break-all pr-2">
							{row.segments
								? row.segments.map((s, i) => (
										<span key={i} className={cn(s.changed && (row.kind === "add" ? "bg-emerald-500/30" : "bg-red-500/30"))}>
											{s.text}
										</span>
									))
								: row.text || " "}
						</span>
					</div>
				),
			)}
		</div>
	);
}

interface FileHistoryDialogProps {
	workspacePath: string;
	// Workspace-relative path of the file
	path: string;
	// What the editor holds now, when the file is open in one; otherwise the file on disk is used
	currentText?: string;
	// Puts an older text into the open editor. Without it a text file can be inspected but not restored here,
	// because restoring behind a live editor would fight the shared document.
	onRestoreText?: (text: string) => void;
	// Called after a binary file was put back on disk
	onRestored?: () => void;
	readOnly?: boolean;
	// Who is naming versions here; shown next to them in the history
	authorName?: string;
	// Called after a version was named, to share it with collaborators. Returns false when it could not be shared.
	onNamed?: (label: string, text: string) => boolean;
	onClose: () => void;
}

// Timeline of a file's saved versions, with a diff against the current text or the version before, and restore
export default function FileHistoryDialog({ workspacePath, path, currentText, onRestoreText, onRestored, readOnly = false, authorName, onNamed, onClose }: FileHistoryDialogProps) {
	const fileName = path.split("/").pop() ?? path;
	const isText = !isBinaryFile(fileName) && !isDocumentFile(fileName);

	const [versions, setVersions] = useState<FileVersion[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [selected, setSelected] = useState<number | null>(null);
	const [mode, setMode] = useState<"since" | "in">("since");
	const [ignoreWhitespace, setIgnoreWhitespace] = useState(false);
	const [texts, setTexts] = useState<Record<number, string>>({});
	const [diskText, setDiskText] = useState<string | null>(null);
	const [label, setLabel] = useState("");
	const [busy, setBusy] = useState(false);
	const [confirming, setConfirming] = useState(false);
	const [restored, setRestored] = useState(false);
	const [notice, setNotice] = useState<string | null>(null);

	const load = useCallback(async () => {
		try {
			const list = await listFileVersions(workspacePath, path);
			setVersions(list);
			setSelected((current) => current ?? list[0]?.id ?? null);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}, [workspacePath, path]);
	useEffect(() => void load(), [load]);

	// The file on disk stands in for the editor when the file is not open in one
	useEffect(() => {
		if (!isText || currentText !== undefined) return;
		readWorkspaceFile(workspacePath, path).then(setDiskText).catch(() => setDiskText(""));
	}, [isText, currentText, workspacePath, path]);
	const current = currentText ?? diskText;

	const index = versions?.findIndex((v) => v.id === selected) ?? -1;
	const version = index >= 0 ? versions![index] : null;
	const previous = index >= 0 ? versions![index + 1] : undefined;

	// Fetch the text of the selected version, and of the one before it when comparing with that
	useEffect(() => {
		if (!isText || !version) return;
		for (const id of [version.id, mode === "in" ? previous?.id : undefined]) {
			if (id === undefined || texts[id] !== undefined) continue;
			readFileVersion(workspacePath, id)
				.then((text) => setTexts((prev) => ({ ...prev, [id]: text })))
				.catch((err) => setError(err instanceof Error ? err.message : String(err)));
		}
	}, [isText, version, previous, mode, texts, workspacePath]);

	const diff = useMemo(() => {
		if (!version || texts[version.id] === undefined) return null;
		if (mode === "since") return current === null ? null : diffLines(texts[version.id], current, { ignoreWhitespace });
		const before = previous ? texts[previous.id] : "";
		return before === undefined ? null : diffLines(before, texts[version.id], { ignoreWhitespace });
	}, [version, previous, texts, mode, current, ignoreWhitespace]);

	const saveNamed = async () => {
		if (!label.trim() || current === null) return;
		setBusy(true);
		try {
			await recordFileVersion(workspacePath, path, current, { label: label.trim(), author: authorName });
			const shared = onNamed?.(label.trim(), current);
			setNotice(shared === false ? "Saved here. It is too large to share with collaborators." : onNamed ? "Saved, and shared with collaborators who are connected." : null);
			setLabel("");
			await load();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	};

	const restore = async () => {
		if (!version) return;
		if (isText) {
			if (texts[version.id] === undefined || !onRestoreText) return;
			onRestoreText(texts[version.id]);
			onClose();
			return;
		}
		setBusy(true);
		try {
			await restoreFileVersion(workspacePath, version.id);
			setRestored(true);
			setConfirming(false);
			onRestored?.();
			await load();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	};

	const canRestore = !readOnly && version !== null && (isText ? !!onRestoreText && texts[version.id] !== undefined : true);

	return (
		<Dialog isOpen onOpenChange={(open) => !open && onClose()} className="sm:max-w-5xl">
			<div className="flex h-[70vh] min-h-0 flex-col gap-4">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<History className="size-4" />
						History of {fileName}
					</DialogTitle>
					<DialogDescription>
						Versions are kept on this device each time the file is saved, synced or imported{isText ? ", and automatically while you edit" : ""}.
					</DialogDescription>
				</DialogHeader>

				{error && (
					<p role="alert" className="border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
						{error}
					</p>
				)}

				{versions === null && !error ? (
					<Loading fill />
				) : versions?.length === 0 ? (
					<p className="flex-1 text-sm text-muted-foreground">
						No versions yet. The first one is kept the next time this file is saved.
					</p>
				) : (
					<div className="flex min-h-0 flex-1 gap-4">
						<ul className="w-64 shrink-0 space-y-1 overflow-y-auto border-r pr-2" aria-label="Versions">
							{versions?.map((v) => (
								<li key={v.id}>
									<button
										type="button"
										aria-pressed={v.id === selected}
										onClick={() => {
											setSelected(v.id);
											setConfirming(false);
											setRestored(false);
										}}
										className={cn("w-full px-2 py-1.5 text-left text-xs hover:bg-muted/50", v.id === selected && "bg-primary/10")}
									>
										<span className="block font-medium">{new Date(v.createdAt).toLocaleString()}</span>
										<span className="block text-muted-foreground">
											{SOURCES[v.source] ?? v.source} · {formatSize(v.size)}
										</span>
										{v.label && <span className="block truncate font-semibold text-primary">{v.label}</span>}
										{v.author && <span className="block truncate text-muted-foreground">by {v.author}</span>}
									</button>
								</li>
							))}
						</ul>

						<div className="flex min-w-0 flex-1 flex-col gap-3">
							{isText ? (
								<>
									<div className="flex flex-wrap items-center gap-3 text-xs">
										<div role="group" aria-label="Compare" className="inline-flex border">
											<Button size="xs" variant={mode === "since" ? "secondary" : "ghost"} aria-pressed={mode === "since"} onPress={() => setMode("since")}>
												Changes since this version
											</Button>
											<Button size="xs" variant={mode === "in" ? "secondary" : "ghost"} aria-pressed={mode === "in"} onPress={() => setMode("in")}>
												Changes in this version
											</Button>
										</div>
										<label className="flex items-center gap-1.5">
											<input type="checkbox" checked={ignoreWhitespace} onChange={(e) => setIgnoreWhitespace(e.target.checked)} />
											Ignore whitespace
										</label>
										{diff && !diff.identical && (
											<span className="ml-auto tabular-nums">
												<span className="text-emerald-400">+{diff.added}</span> <span className="text-red-400">-{diff.removed}</span>
											</span>
										)}
									</div>
									<div className="min-h-0 flex-1 overflow-auto border">
										{diff ? <DiffView diff={diff} /> : <Loader2 className="m-4 size-4 animate-spin text-muted-foreground" />}
									</div>
								</>
							) : (
								<div className="flex-1 space-y-2 border p-4 text-sm">
									<p className="font-medium">{version ? new Date(version.createdAt).toLocaleString() : ""}</p>
									<p className="text-xs text-muted-foreground">
										{version ? `${SOURCES[version.source] ?? version.source} · ${formatSize(version.size)}` : ""}
									</p>
									<p className="text-xs text-muted-foreground">
										This is not a text file, so versions cannot be compared here. Restoring puts this version back in the
										workspace; what is there now is kept as a version first.
									</p>
								</div>
							)}

							<div className="flex flex-wrap items-center gap-2">
								{isText && !readOnly && currentText !== undefined && (
									<form
										className="flex items-center gap-2"
										onSubmit={(e) => {
											e.preventDefault();
											void saveNamed();
										}}
									>
										<Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name the current text" maxLength={80} aria-label="Version name" className="h-8 w-56 text-xs" />
										<Button type="submit" size="sm" variant="outline" isDisabled={busy || !label.trim()}>
											<Save className="size-3.5" />
											Save version
										</Button>
									</form>
								)}
								<div className="ml-auto flex items-center gap-2">
									{isText && !onRestoreText && (
										<span className="text-xs text-muted-foreground">Open the file in Notes or Editor to restore a version.</span>
									)}
									{notice && <span role="status" className="text-xs text-muted-foreground">{notice}</span>}
									{restored && <span className="text-xs text-emerald-400">Restored.</span>}
									{!isText && confirming ? (
										<>
											<span className="text-xs">Replace the current file?</span>
											<Button size="sm" variant="outline" onPress={() => setConfirming(false)}>
												Cancel
											</Button>
											<Button size="sm" variant="destructive" isDisabled={busy} onPress={() => void restore()}>
												Restore
											</Button>
										</>
									) : (
										<Button size="sm" isDisabled={!canRestore || busy} onPress={() => (isText ? void restore() : setConfirming(true))}>
											<RotateCcw className="size-3.5" />
											Restore this version
										</Button>
									)}
								</div>
							</div>
						</div>
					</div>
				)}
			</div>
		</Dialog>
	);
}
