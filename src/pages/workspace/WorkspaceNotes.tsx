import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Search, LayoutGrid, Network } from "@/components/animate-icons";

import NoteEditor from "@/components/elements/editor/NoteEditor";
import NoteBoard from "@/components/elements/notes/NoteBoard";
import NoteGraph from "@/components/elements/notes/NoteGraph";
import PageHeader from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

import { useCollabDoc } from "@/hooks/useCollabDoc";
import { useErrorLog } from "@/hooks/useErrorLog";
import { useOpenParam } from "@/hooks/useOpenParam";
import { useReportItem } from "@/hooks/usePresence";
import { isNoteFile } from "@/lib/editor/languages";
import { positionsFor } from "@/lib/notes/board";
import { buildEdges, type Point } from "@/lib/notes/graph";
import { createWorkspaceFile, deleteWorkspaceItem, listWorkspaceFiles, readWorkspaceFile, writeWorkspaceFile } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/store/workspace/WorkspaceContext";
import { useP2P, useIsViewer } from "@/store/p2p/P2PContext";
import type { WorkspaceFile } from "@/types/workspace";
import Loading from "@/components/Loading";

const BOARD_DOC = "board:notes";
// The most of a note that is shared for the cards; longer notes show the start
const MAX_LIVE_CHARS = 20000;
type View = "board" | "graph";

// Notes: rich-text notes (.txt) as cards on a shared board, or as a graph of the [[links]] between them. Markdown
// files and code belong in the Editor. A note opens in a panel over the board and is edited live by everyone.
export default function WorkspaceNotes() {
	const { workspace, refreshMetadata, addActivityEvent } = useWorkspace();
	const logError = useErrorLog();
	const navigate = useNavigate();
	const isViewer = useIsViewer();
	const { lastSyncedFile, viewersAt, selfName } = useP2P();

	const [notes, setNotes] = useState<WorkspaceFile[]>([]);
	const [texts, setTexts] = useState<Record<string, string>>({});
	const [loading, setLoading] = useState(true);
	const [view, setView] = useState<View>("board");
	const [query, setQuery] = useState("");

	// The note open in the panel
	const [selected, setSelected] = useState<WorkspaceFile | null>(null);
	const [noteContent, setNoteContent] = useState("");
	const [contentLoading, setContentLoading] = useState(false);

	const [isNewOpen, setIsNewOpen] = useState(false);
	const [newTitle, setNewTitle] = useState("");
	const [deleting, setDeleting] = useState<WorkspaceFile | null>(null);
	const [submitting, setSubmitting] = useState(false);

	// Where the cards sit is a shared document, so everyone sees a card move as it is dragged
	const board = useCollabDoc(workspace?.path, BOARD_DOC);
	const [stored, setStored] = useState<Record<string, Point>>({});
	// The text of each note as it is being written, shared through the same document
	const [liveTexts, setLiveTexts] = useState<Record<string, string>>({});
	useEffect(() => {
		if (!board) return;
		const map = board.doc.getMap<Point>("positions");
		const read = () => setStored(Object.fromEntries(map.entries()));
		const texts = board.doc.getMap<string>("live");
		const readTexts = () => setLiveTexts(Object.fromEntries(texts.entries()));
		read();
		readTexts();
		map.observe(read);
		texts.observe(readTexts);
		return () => {
			map.unobserve(read);
			texts.unobserve(readTexts);
		};
	}, [board]);

	const loadNotes = useCallback(async () => {
		if (!workspace?.path) return;
		try {
			const [inNotes, inFiles] = await Promise.all([
				listWorkspaceFiles(workspace.path, "notes").catch(() => []),
				listWorkspaceFiles(workspace.path, "files").catch(() => []),
			]);
			const all = [...inNotes, ...inFiles].filter((f) => !f.is_dir && isNoteFile(f.name));
			setNotes(Array.from(new Map(all.map((f) => [f.path, f])).values()));
		} catch (err) {
			logError(err, { source: "notes" });
		} finally {
			setLoading(false);
		}
	}, [workspace?.path, logError]);

	useEffect(() => {
		void loadNotes();
	}, [loadNotes]);

	// A collaborator's changes arrive as files
	useEffect(() => {
		if (lastSyncedFile && workspace?.path) void loadNotes();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [lastSyncedFile]);

	// What each card shows, and the links for the graph, come from the saved text of every note
	useEffect(() => {
		const root = workspace?.path;
		if (!root) return;
		let live = true;
		Promise.all(notes.map(async (n) => [n.path, await readWorkspaceFile(root, n.path.replace(/^\/+/, "")).catch(() => "")] as const)).then(
			(entries) => live && setTexts(Object.fromEntries(entries)),
		);
		return () => {
			live = false;
		};
	}, [workspace?.path, notes, lastSyncedFile]);

	// The text of the open note
	useEffect(() => {
		const root = workspace?.path;
		if (!root || !selected) {
			setNoteContent("");
			return;
		}
		let live = true;
		setContentLoading(true);
		readWorkspaceFile(root, selected.path.replace(/^\/+/, ""))
			.then((text) => live && setNoteContent(text))
			.catch((err) => logError(err, { source: "notes" }))
			.finally(() => live && setContentLoading(false));
		return () => {
			live = false;
		};
	}, [workspace?.path, selected, logError]);

	useReportItem(selected ? selected.path.replace(/^\/+/, "") : null);

	// Deep link from workspace search or a [[link]] chip; Markdown notes open in the Editor
	useOpenParam((path) => {
		const note = notes.find((n) => n.path === path);
		if (note) setSelected(note);
		else if (!isNoteFile(path)) navigate(`/workspace/editor?open=${encodeURIComponent(path)}`, { replace: true });
	}, !loading);

	const infos = useMemo(() => notes.map((n) => ({ path: n.path, name: n.name, text: liveTexts[n.path] ?? texts[n.path] ?? "" })), [notes, texts, liveTexts]);
	const edges = useMemo(() => buildEdges(infos), [infos]);
	const positions = useMemo(() => positionsFor(notes.map((n) => n.path), stored), [notes, stored]);
	const shown = useMemo(() => {
		const q = query.trim().toLowerCase();
		return q ? infos.filter((n) => n.name.toLowerCase().includes(q) || n.text.toLowerCase().includes(q)) : infos;
	}, [infos, query]);

	const moveCard = (path: string, to: Point) => {
		if (isViewer || !board) return;
		board.doc.getMap<Point>("positions").set(path, to);
	};

	// While a note is edited, its text goes into the shared board so every card and the graph follow each keystroke. A short
	// wait groups fast typing; the last text is sent when the note is closed.
	const pendingText = useRef<{ path: string; text: string } | null>(null);
	const textTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const flushText = useCallback(() => {
		const pending = pendingText.current;
		pendingText.current = null;
		if (!pending || !board) return;
		const map = board.doc.getMap<string>("live");
		if (map.get(pending.path) !== pending.text) map.set(pending.path, pending.text);
	}, [board]);
	const shareText = useCallback(
		(path: string, text: string) => {
			if (isViewer || !board) return;
			pendingText.current = { path, text: text.slice(0, MAX_LIVE_CHARS) };
			if (textTimer.current) clearTimeout(textTimer.current);
			textTimer.current = setTimeout(flushText, 250);
		},
		[isViewer, board, flushText],
	);
	useEffect(() => flushText, [flushText]);

	const openByPath = (path: string) => {
		const note = notes.find((n) => n.path === path);
		if (note) setSelected(note);
	};

	const handleSave = async (newText: string) => {
		if (!workspace?.path || !selected) return;
		try {
			await writeWorkspaceFile(workspace.path, selected.path.replace(/^\/+/, ""), newText);
			setNoteContent(newText);
			setTexts((prev) => ({ ...prev, [selected.path]: newText }));
			addActivityEvent("Saved note", `Edited note ${selected.name}`, selected.path, "note");
			await refreshMetadata();
		} catch (err) {
			logError(err, { source: "notes" });
			throw err;
		}
	};

	const handleCreate = async (e: React.FormEvent) => {
		e.preventDefault();
		if (isViewer || !workspace?.path || !newTitle.trim()) return;
		try {
			setSubmitting(true);
			// Notes are rich text; a name that ends in .md is made a .txt note, and Markdown files are made in the Editor
			let filename = newTitle.trim().replace(/\.(md|markdown)$/i, "");
			if (!isNoteFile(filename)) filename += ".txt";
			await createWorkspaceFile(workspace.path, "notes", filename);
			addActivityEvent("Created note", `Created note ${filename}`, `/notes/${filename}`, "note");
			setIsNewOpen(false);
			setNewTitle("");
			await loadNotes();
			await refreshMetadata();
			setSelected({ name: filename, path: `/notes/${filename}`, is_dir: false, size: 0, modified_at: new Date().toISOString() });
		} catch (err) {
			logError(err, { source: "notes" });
		} finally {
			setSubmitting(false);
		}
	};

	const handleDelete = async () => {
		if (isViewer || !workspace?.path || !deleting) return;
		try {
			await deleteWorkspaceItem(workspace.path, deleting.path.replace(/^\/+/, ""));
			addActivityEvent("Deleted note", `Deleted note ${deleting.name}`, undefined, "note");
			board?.doc.getMap<Point>("positions").delete(deleting.path);
			board?.doc.getMap<string>("live").delete(deleting.path);
			if (selected?.path === deleting.path) setSelected(null);
			setDeleting(null);
			await loadNotes();
			await refreshMetadata();
		} catch (err) {
			logError(err, { source: "notes" });
		}
	};

	const toggle = (value: View, label: string, icon: React.ReactNode) => (
		<button
			key={value}
			type="button"
			aria-pressed={view === value}
			onClick={() => setView(value)}
			className={cn(
				"flex cursor-pointer items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors",
				view === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
			)}
		>
			{icon}
			{label}
		</button>
	);

	return (
		<div className="flex h-[calc(100vh-10rem)] flex-col gap-4">
			{/* Header */}
			<PageHeader
				title="Notes"
				description="Notes float on a shared board and link to each other with [[Note name]]. Markdown files live in the Editor."
				actions={
					<>
{!isViewer && (
					<Button
						onPress={() => {
							setNewTitle("");
							setIsNewOpen(true);
						}}
					>
						<Plus className="size-4" />
						New note
					</Button>
				)}
					</>
				}
			/>

			<div className="relative flex min-h-0 flex-1 flex-col border">
				{/* Toolbar */}
				<div className="flex min-h-11 shrink-0 flex-wrap items-center gap-3 border-b bg-muted/20 px-3 py-1.5">
					<div className="flex items-center border" role="group" aria-label="View">
						{toggle("board", "Board", <LayoutGrid className="size-3.5" />)}
						{toggle("graph", "Graph", <Network className="size-3.5" />)}
					</div>
					<div className="relative w-full max-w-xs">
						<Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
						<Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search notes…" aria-label="Search notes" className="h-8 border bg-background pl-8 text-xs" />
					</div>
					<span className="ml-auto text-xs text-muted-foreground">
						{notes.length} {notes.length === 1 ? "note" : "notes"} · {edges.length} {edges.length === 1 ? "link" : "links"}
					</span>
				</div>

				{/* Canvas */}
				<div className="min-h-0 flex-1">
					{loading ? (
						<Loading fill />
					) : notes.length === 0 ? (
						<div className="flex h-full flex-col items-center justify-center p-8 text-center">
							<div className="flex size-12 items-center justify-center bg-muted/60">
								<LayoutGrid className="size-6 text-muted-foreground" />
							</div>
							<h3 className="mt-4 text-base font-semibold">No notes yet</h3>
							<p className="mt-1 max-w-sm text-xs text-muted-foreground">
								Create a note and it appears here as a card you can move around. Everyone in the workspace sees the same board.
							</p>
						</div>
					) : view === "board" ? (
						<NoteBoard
							notes={shown}
							positions={positions}
							edges={edges}
							activePath={selected?.path ?? null}
							onMove={moveCard}
							onOpen={openByPath}
							onDelete={(path) => setDeleting(notes.find((n) => n.path === path) ?? null)}
							viewers={(path) => viewersAt("notes", path.replace(/^\/+/, ""))}
							awareness={board?.awareness}
							userName={selfName ?? "You"}
							readOnly={isViewer}
						/>
					) : (
						<NoteGraph notes={shown} edges={edges} activePath={selected?.path ?? null} onOpen={openByPath} />
					)}
				</div>

				{/* The open note floats over the board */}
				{selected && (
					<aside className="absolute inset-y-0 right-0 z-20 flex w-[min(46rem,92%)] flex-col border-l bg-background shadow-xl" aria-label="Open note">
						{contentLoading ? (
							<Loading fill className="flex-1" />
						) : (
							<NoteEditor
								key={selected.path}
								fileName={selected.name}
								initialContent={noteContent}
								onSave={handleSave}
								onClose={() => setSelected(null)}
								readOnly={isViewer}
								workspacePath={workspace?.path}
								docId={selected.path.replace(/^\/+/, "")}
								notes={notes}
								onOpenNote={openByPath}
								onTextChange={(text) => shareText(selected.path, text)}
							/>
						)}
					</aside>
				)}
			</div>

			{isNewOpen && (
				<Dialog isOpen={isNewOpen} onOpenChange={setIsNewOpen} className="max-w-md">
					<form onSubmit={handleCreate} className="space-y-4">
						<DialogHeader>
							<DialogTitle>New Note</DialogTitle>
							<DialogDescription>A rich-text note with headings and lists. For a Markdown file, make it in the Editor.</DialogDescription>
						</DialogHeader>
						<Input required value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="e.g. Architecture Overview, Meeting Notes" autoFocus />
						<DialogFooter>
							<Button type="button" variant="outline" onPress={() => setIsNewOpen(false)} isDisabled={submitting}>
								Cancel
							</Button>
							<Button type="submit" isDisabled={submitting || !newTitle.trim()}>
								{submitting ? "Creating…" : "Create Note"}
							</Button>
						</DialogFooter>
					</form>
				</Dialog>
			)}

			{deleting && (
				<Dialog isOpen onOpenChange={(open) => !open && setDeleting(null)}>
					<div className="space-y-4">
						<DialogHeader>
							<DialogTitle>Delete Note</DialogTitle>
							<DialogDescription>
								Move <span className="font-semibold text-foreground">{deleting.name}</span> to the Trash? You can restore it from there.
							</DialogDescription>
						</DialogHeader>
						<DialogFooter>
							<Button variant="outline" onPress={() => setDeleting(null)}>
								Cancel
							</Button>
							<Button variant="destructive" onPress={handleDelete}>
								Delete
							</Button>
						</DialogFooter>
					</div>
				</Dialog>
			)}
		</div>
	);
}
