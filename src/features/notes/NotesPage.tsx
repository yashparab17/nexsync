import { LAYOUT } from "@/lib/workspaceLayout";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DropOverlay, useDropNotice, useFileDrop } from "@/hooks/useFileDrop";
import { dropSummary, importDropped } from "@/lib/dropImport";
import Welcome from "@/components/elements/Welcome";
import Toolbar, { ToolbarSearch } from "@/components/layout/Toolbar";
import { useNavigate } from "react-router-dom";
import { CalendarPlus, FilePlus, FileText, LayoutGrid, Network, Pencil, Pin, PinOff, Plus, Search, Trash2 } from "@/components/animate-icons";

import NoteEditor from "@/features/editor/components/NoteEditor";
import NoteBoard from "@/components/elements/notes/NoteBoard";
import NoteGraph from "@/components/elements/notes/NoteGraph";
import { useContextMenu } from "@/components/elements/ContextMenu";
import EditorTabs from "@/features/editor/components/EditorTabs";
import Finder from "@/components/elements/Finder";
import PresenceDots from "@/components/elements/PresenceDots";
import CollapsiblePane, { LIST_WIDTH } from "@/components/layout/CollapsiblePane";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogHeading } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

import { useCollabDoc } from "@/hooks/useCollabDoc";
import { useListKeys } from "@/hooks/useListKeys";
import { useErrorLog } from "@/hooks/useErrorLog";
import { useOpenParam } from "@/hooks/useOpenParam";
import { useCollapsed } from "@/hooks/useCollapsed";
import { useReportItem } from "@/hooks/usePresence";
import { useSyncedIn } from "@/hooks/useSyncedIn";
import { isNoteFile } from "@/lib/editor/languages";
import { positionsFor, summarize } from "@/features/notes/lib/board";
import { noteTitle } from "@/features/notes/lib/links";
import { pushRecent } from "@/lib/recentFiles";
import { readPins, writePins } from "@/features/notes/lib/pins";
import { validateFileName } from "@/lib/validation";
import { buildEdges, type Point } from "@/features/notes/lib/graph";
import { createWorkspaceFile, deleteWorkspaceItem, listWorkspaceFiles, readWorkspaceFile, renameWorkspaceItem, renameYjsDoc, writeWorkspaceFile } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/store/workspace/WorkspaceContext";
import { useP2P, useIsViewer } from "@/store/p2p/P2PContext";
import type { WorkspaceFile } from "@/types/workspace";
import Loading from "@/components/Loading";
import { useMyName } from "@/hooks/useMyName";

const BOARD_DOC = "board:notes";
// The most of a note that is shared for the cards; longer notes show the start
const MAX_LIVE_CHARS = 20000;
type View = "note" | "board" | "graph";

const rel = (path: string) => path.replace(/^\/+/, "");
const NO_DIRTY = new Set<string>();

// "3 min ago", "Yesterday", "12 Mar"
function ago(iso: string): string {
	const then = new Date(iso).getTime();
	if (!Number.isFinite(then)) return "";
	const mins = Math.round((Date.now() - then) / 60000);
	if (mins < 1) return "Just now";
	if (mins < 60) return `${mins} min ago`;
	const hours = Math.round(mins / 60);
	if (hours < 24) return `${hours} h ago`;
	const days = Math.round(hours / 24);
	if (days === 1) return "Yesterday";
	if (days < 7) return `${days} days ago`;
	return new Date(then).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

const today = () => {
	const d = new Date();
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// Notes, in the manner of Obsidian and Apple Notes: a searchable list on the left, notes open in tabs, and a panel with
// the outline and links on the right. The same notes can be seen as a shared board or as a graph of their [[links]].
// Notes save themselves. Markdown files and code belong in the Editor.
export default function NotesPage() {
	const { workspace, refreshMetadata, addActivityEvent } = useWorkspace();
	const logError = useErrorLog();
	const navigate = useNavigate();
	const isViewer = useIsViewer();
	const { viewersAt } = useP2P();
	const myName = useMyName();
	const synced = useSyncedIn(LAYOUT.notes, LAYOUT.others);
	const workspacePath = workspace?.path;

	const [notes, setNotes] = useState<WorkspaceFile[]>([]);
	const [texts, setTexts] = useState<Record<string, string>>({});
	const [loading, setLoading] = useState(true);
	const [view, setView] = useState<View>("note");
	const [query, setQuery] = useState("");
	const [, toggleList] = useCollapsed("notes.list");
	const [pins, setPins] = useState<string[]>([]);
	useEffect(() => {
		if (workspacePath) setPins(readPins(workspacePath));
	}, [workspacePath]);

	// Open notes (tabs) and the one in front
	const [tabs, setTabs] = useState<string[]>([]);
	const [selectedPath, setSelectedPath] = useState<string | null>(null);
	const [noteContent, setNoteContent] = useState("");
	const [contentLoading, setContentLoading] = useState(false);
	const selected = useMemo(() => notes.find((n) => n.path === selectedPath) ?? null, [notes, selectedPath]);

	const [isNewOpen, setIsNewOpen] = useState(false);
	useListKeys(isViewer ? undefined : () => { setNewTitle(""); setIsNewOpen(true); });
	const [newTitle, setNewTitle] = useState("");
	const [deleting, setDeleting] = useState<WorkspaceFile | null>(null);
	const [renaming, setRenaming] = useState<{ note: WorkspaceFile; value: string } | null>(null);
	const [renameError, setRenameError] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [switcher, setSwitcher] = useState(false);
	const [switcherQuery, setSwitcherQuery] = useState("");
	const menu = useContextMenu();

	// Where the cards sit is a shared document, so everyone sees a card move as it is dragged
	const board = useCollabDoc(workspacePath, BOARD_DOC);
	const [stored, setStored] = useState<Record<string, Point>>({});
	// The text of each note as it is being written, shared through the same document
	const [liveTexts, setLiveTexts] = useState<Record<string, string>>({});
	useEffect(() => {
		if (!board) return;
		const map = board.doc.getMap<Point>("positions");
		const read = () => setStored(Object.fromEntries(map.entries()));
		const live = board.doc.getMap<string>("live");
		const readTexts = () => setLiveTexts(Object.fromEntries(live.entries()));
		read();
		readTexts();
		map.observe(read);
		live.observe(readTexts);
		return () => {
			map.unobserve(read);
			live.unobserve(readTexts);
		};
	}, [board]);

	const loadNotes = useCallback(async () => {
		if (!workspacePath) return;
		try {
			const [inNotes, inFiles] = await Promise.all([
				listWorkspaceFiles(workspacePath, "notes").catch(() => []),
				listWorkspaceFiles(workspacePath, LAYOUT.others).catch(() => []),
			]);
			const all = [...inNotes, ...inFiles].filter((f) => !f.is_dir && isNoteFile(f.name));
			setNotes(Array.from(new Map(all.map((f) => [f.path, f])).values()));
		} catch (err) {
			logError(err, { source: "notes" });
		} finally {
			setLoading(false);
		}
	}, [workspacePath, logError]);

	useEffect(() => {
		void loadNotes();
	}, [loadNotes]);

	// A collaborator's changes arrive as files
	useEffect(() => {
		if (synced && workspacePath) void loadNotes();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [synced]);

	// What each row and card shows, and the links for the graph, come from the saved text of every note
	useEffect(() => {
		if (!workspacePath) return;
		let live = true;
		Promise.all(notes.map(async (n) => [n.path, await readWorkspaceFile(workspacePath, rel(n.path)).catch(() => "")] as const)).then(
			(entries) => live && setTexts(Object.fromEntries(entries)),
		);
		return () => {
			live = false;
		};
	}, [workspacePath, notes, synced]);

	// The text of the note in front
	useEffect(() => {
		if (!workspacePath || !selectedPath) {
			setNoteContent("");
			return;
		}
		let live = true;
		setContentLoading(true);
		readWorkspaceFile(workspacePath, rel(selectedPath))
			.then((text) => live && setNoteContent(text))
			.catch((err) => logError(err, { source: "notes" }))
			.finally(() => live && setContentLoading(false));
		return () => {
			live = false;
		};
	}, [workspacePath, selectedPath, logError]);

	useReportItem(selectedPath && view === "note" ? rel(selectedPath) : null);

	const openNote = useCallback((path: string) => {
		setTabs((prev) => (prev.includes(path) ? prev : [...prev, path]));
		setSelectedPath(path);
		setView("note");
		if (workspacePath) pushRecent(workspacePath, rel(path));
	}, [workspacePath]);

	// Deep link from workspace search or a [[link]] chip; Markdown notes open in the Editor
	useOpenParam((path) => {
		if (notes.some((n) => n.path === path)) openNote(path);
		else if (!isNoteFile(path)) navigate(`/workspace/editor?open=${encodeURIComponent(path)}`, { replace: true });
	}, !loading);

	const closeTab = (path: string) => {
		setTabs((prev) => {
			const next = prev.filter((p) => p !== path);
			if (selectedPath === path) setSelectedPath(next[Math.max(0, prev.indexOf(path) - 1)] ?? null);
			return next;
		});
	};

	// A note that was deleted or renamed elsewhere leaves the tab strip
	useEffect(() => {
		if (loading) return;
		const exists = new Set(notes.map((n) => n.path));
		setTabs((prev) => (prev.every((p) => exists.has(p)) ? prev : prev.filter((p) => exists.has(p))));
		setSelectedPath((cur) => (cur && !exists.has(cur) ? null : cur));
	}, [notes, loading]);

	const infos = useMemo(() => notes.map((n) => ({ path: n.path, name: n.name, text: liveTexts[n.path] ?? texts[n.path] ?? "" })), [notes, texts, liveTexts]);
	const edges = useMemo(() => buildEdges(infos), [infos]);
	const positions = useMemo(() => positionsFor(notes.map((n) => n.path), stored), [notes, stored]);
	const modified = useMemo(() => new Map(notes.map((n) => [n.path, n.modified_at])), [notes]);
	const linkCount = useMemo(() => {
		const count = new Map<string, number>();
		for (const e of edges) {
			count.set(e.from, (count.get(e.from) ?? 0) + 1);
			count.set(e.to, (count.get(e.to) ?? 0) + 1);
		}
		return count;
	}, [edges]);

	const shown = useMemo(() => {
		const q = query.trim().toLowerCase();
		const list = q ? infos.filter((n) => n.name.toLowerCase().includes(q) || n.text.toLowerCase().includes(q)) : infos.slice();
		// Searching puts a note whose name starts with the words first, then one that contains them, then the rest; with
		// nothing typed, the newest edit is first
		const rank = (name: string) => (!q ? 0 : name.toLowerCase().startsWith(q) ? 0 : name.toLowerCase().includes(q) ? 1 : 2);
		return list.sort((a, b) => rank(a.name) - rank(b.name) || (modified.get(b.path) ?? "").localeCompare(modified.get(a.path) ?? ""));
	}, [infos, query, modified]);
	const pinned = shown.filter((n) => pins.includes(n.path));
	const unpinned = shown.filter((n) => !pins.includes(n.path));

	const togglePin = (path: string) => {
		if (!workspacePath) return;
		const next = pins.includes(path) ? pins.filter((p) => p !== path) : [...pins, path];
		setPins(next);
		writePins(workspacePath, next);
	};

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

	const handleSave = async (note: WorkspaceFile, newText: string) => {
		if (!workspacePath) return;
		try {
			await writeWorkspaceFile(workspacePath, rel(note.path), newText);
			setTexts((prev) => ({ ...prev, [note.path]: newText }));
			if (note.path === selectedPath) setNoteContent(newText);
			addActivityEvent("Saved note", `Edited note ${note.name}`, note.path, "note");
			await refreshMetadata();
		} catch (err) {
			logError(err, { source: "notes" });
			throw err;
		}
	};

	const createNote = async (title: string) => {
		if (isViewer || !workspacePath || !title.trim() || validateFileName(title.trim())) return;
		// Notes are rich text; a name that ends in .md is made a .txt note, and Markdown files are made in the Editor
		let filename = title.trim().replace(/[\\/]/g, "-").replace(/\.(md|markdown)$/i, "");
		if (!isNoteFile(filename)) filename += ".txt";
		const path = `/notes/${filename}`;
		if (notes.some((n) => n.path === path)) return openNote(path);
		try {
			setSubmitting(true);
			await createWorkspaceFile(workspacePath, "notes", filename);
			addActivityEvent("Created note", `Created note ${filename}`, path, "note");
			setIsNewOpen(false);
			setNewTitle("");
			await loadNotes();
			await refreshMetadata();
			openNote(path);
		} catch (err) {
			logError(err, { source: "notes" });
		} finally {
			setSubmitting(false);
		}
	};

	// One note a day, named by its date, opened if it already exists
	// Note files dropped on the page are added to the notes folder; other kinds belong in Files or Assets
	const dropNotice = useDropNotice();
	const { dragging, bind: dropProps } = useFileDrop(async (items) => {
		const notesOnly = items.filter((i) => isNoteFile(i.file.name)).map((i) => ({ ...i, rel: i.file.name }));
		if (notesOnly.length === 0) return dropNotice.show("Only note files (.md, .txt) can be dropped here. Use Files or Assets for the rest.");
		const result = await importDropped(workspacePath!, "notes", notesOnly);
		dropNotice.show(dropSummary(result) + (notesOnly.length < items.length ? " Other kinds were skipped." : ""));
		await loadNotes();
	}, isViewer || !workspacePath);

	const openToday = () => void createNote(today());

	const handleDelete = async () => {
		if (isViewer || !workspacePath || !deleting) return;
		try {
			await deleteWorkspaceItem(workspacePath, rel(deleting.path));
			addActivityEvent("Deleted note", `Deleted note ${deleting.name}`, undefined, "note");
			board?.doc.getMap<Point>("positions").delete(deleting.path);
			board?.doc.getMap<string>("live").delete(deleting.path);
			closeTab(deleting.path);
			if (pins.includes(deleting.path)) togglePin(deleting.path);
			setDeleting(null);
			await loadNotes();
			await refreshMetadata();
		} catch (err) {
			logError(err, { source: "notes" });
		}
	};

	const handleRename = async () => {
		if (!renaming || !workspacePath) return;
		const { note } = renaming;
		let name = renaming.value.trim().replace(/[\\/]/g, "-");
		if (!name) return setRenameError("Name is required.");
		const problem = validateFileName(name);
		if (problem) return setRenameError(problem);
		if (!isNoteFile(name)) name += note.name.slice(note.name.lastIndexOf(".")) || ".txt";
		if (name === note.name) return setRenaming(null);
		if (notes.some((n) => n.name === name && n.path.slice(0, n.path.lastIndexOf("/")) === note.path.slice(0, note.path.lastIndexOf("/")))) return setRenameError("A note with that name already exists.");
		try {
			await renameWorkspaceItem(workspacePath, rel(note.path), name);
			const moved = `${note.path.slice(0, note.path.lastIndexOf("/"))}/${name}`;
			void renameYjsDoc(workspacePath, rel(note.path), rel(moved)).catch(() => {});
			setTabs((prev) => prev.map((p) => (p === note.path ? moved : p)));
			setSelectedPath((cur) => (cur === note.path ? moved : cur));
			if (pins.includes(note.path)) {
				const next = pins.map((p) => (p === note.path ? moved : p));
				setPins(next);
				writePins(workspacePath, next);
			}
			board?.doc.getMap<Point>("positions").delete(note.path);
			setRenaming(null);
			setRenameError("");
			await loadNotes();
		} catch (err) {
			setRenameError(err instanceof Error ? err.message : String(err));
		}
	};

	const noteMenu = (e: React.MouseEvent, path: string) => {
		const note = notes.find((n) => n.path === path);
		if (!note) return;
		menu.open(e, [
			{ label: "Open", icon: <FileText className="size-4" />, onSelect: () => openNote(path) },
			{ label: pins.includes(path) ? "Unpin" : "Pin to top", icon: pins.includes(path) ? <PinOff className="size-4" /> : <Pin className="size-4" />, onSelect: () => togglePin(path) },
			"separator",
			{ label: "Rename…", icon: <Pencil className="size-4" />, disabled: isViewer, onSelect: () => { setRenameError(""); setRenaming({ note, value: noteTitle(note.name) }); } },
			{ label: "Delete…", icon: <Trash2 className="size-4" />, danger: true, disabled: isViewer, onSelect: () => setDeleting(note) },
		]);
	};

	// Keys: Ctrl+O or Ctrl+P jumps to a note, Ctrl+N makes one, Ctrl+\ hides the list
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
			const k = e.key.toLowerCase();
			if (k === "o" || k === "p") {
				e.preventDefault();
				setSwitcherQuery("");
				setSwitcher(true);
			} else if (k === "n" && !isViewer) {
				e.preventDefault();
				setNewTitle("");
				setIsNewOpen(true);
			} else if (e.key === "\\") {
				e.preventDefault();
				toggleList();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [isViewer, toggleList]);

	const switcherItems = useMemo(
		() => [...infos].sort((a, b) => (modified.get(b.path) ?? "").localeCompare(modified.get(a.path) ?? "")).map((n) => ({ id: n.path, label: noteTitle(n.name), detail: ago(modified.get(n.path) ?? ""), group: "Recent", icon: <FileText className="size-4" /> })),
		[infos, modified],
	);

	const row = (n: (typeof infos)[number]) => {
		const active = n.path === selectedPath && view === "note";
		const { snippet } = summarize(n.text, 0, 90);
		const links = linkCount.get(n.path) ?? 0;
		const people = viewersAt("notes", rel(n.path));
		return (
			<li key={n.path}>
				<button
					type="button"
					data-nav
					onClick={() => openNote(n.path)}
					onContextMenu={(e) => noteMenu(e, n.path)}
					aria-current={active ? "true" : undefined}
					className={cn(
						"flex w-full cursor-pointer flex-col gap-0.5 border-b px-3 py-3 text-left outline-none transition-colors focus-visible:bg-muted",
						active ? "bg-primary/10 shadow-[inset_2px_0_0_var(--primary)]" : "hover:bg-muted/50",
					)}
				>
					<span className="flex items-center gap-2">
						<span className="min-w-0 flex-1 truncate text-sm font-medium">{noteTitle(n.name)}</span>
						<PresenceDots names={people} doing="reading" />
						{pins.includes(n.path) && <Pin className="size-3.5 shrink-0 text-primary" aria-label="Pinned" />}
						<span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{ago(modified.get(n.path) ?? "")}</span>
					</span>
					<span className="flex items-center gap-2 text-xs text-muted-foreground">
						<span className="min-w-0 flex-1 truncate">{snippet || "No additional text"}</span>
						{links > 0 && <span className="shrink-0 font-mono tabular-nums" title={`${links} links`}>{links} ↔</span>}
					</span>
				</button>
			</li>
		);
	};

	const segment = (value: View, label: string, icon: React.ReactNode) => (
		<Button key={value} variant={view === value ? "secondary" : "ghost"} size="sm" aria-pressed={view === value} onPress={() => setView(value)} className={cn(view !== value && "text-muted-foreground")}>
			{icon}
			{label}
		</Button>
	);


	return (
		<div {...dropProps} className="relative flex h-full min-h-0 bg-background">
			<DropOverlay show={dragging} title="Drop to add to notes" />
			{dropNotice.node}
			{/* Notes list */}
			<CollapsiblePane id="notes.list" defaultWidth={LIST_WIDTH} label="the notes list">
					<aside aria-label="Notes list" className="flex shrink-0 flex-col bg-panel">
						<Toolbar variant="header">
							<ToolbarSearch label="Search notes" placeholder="Search" value={query} onChange={setQuery} className="min-w-0 flex-1" />
							{!isViewer && (
								<>
									<Button variant="ghost" size="icon-xs" aria-label="Open today's note" onPress={openToday}>
										<CalendarPlus className="size-4" />
									</Button>
									<Button
										variant="ghost"
										size="icon-xs"
										aria-label="New note"
										onPress={() => {
											setNewTitle("");
											setIsNewOpen(true);
										}}
									>
										<Plus className="size-4" />
									</Button>
								</>
							)}
						</Toolbar>
						<div className="min-h-0 flex-1 overflow-y-auto">
							{loading ? (
								<Loading fill />
							) : notes.length === 0 ? (
								<p className="p-4 text-sm text-muted-foreground">No notes yet. Make one with the plus above, or press Ctrl+N.</p>
							) : shown.length === 0 ? (
								<p className="p-4 text-sm text-muted-foreground">No note mentions “{query}”.</p>
							) : (
								<>
									{pinned.length > 0 && (
										<>
											<h2 className="border-b px-3 py-2 font-mono text-xs text-muted-foreground">Pinned</h2>
											<ul>{pinned.map(row)}</ul>
											{unpinned.length > 0 && <h2 className="border-b px-3 py-2 font-mono text-xs text-muted-foreground">Notes</h2>}
										</>
									)}
									<ul>{unpinned.map(row)}</ul>
								</>
							)}
						</div>
					</aside>
			</CollapsiblePane>

			{/* Tabs and the open note */}
			<section className="flex min-w-0 flex-1 flex-col" aria-label="Note">
				<Toolbar variant="tabs">
					{view === "note" ? <EditorTabs tabs={tabs} active={selectedPath} side={null} dirty={NO_DIRTY} onSelect={setSelectedPath} onClose={closeTab} onReorder={(from, to) => setTabs((prev) => { const next = [...prev]; next.splice(to, 0, next.splice(from, 1)[0]); return next; })} onContextMenu={noteMenu} label={(path) => noteTitle(path.split("/").pop() ?? path)} /> : <div className="flex-1" />}
					<div className="flex shrink-0 items-center gap-1 border-l px-2" role="group" aria-label="View">
						{segment("note", "Note", <FileText className="size-3.5" />)}
						{segment("board", "Board", <LayoutGrid className="size-3.5" />)}
						{segment("graph", "Graph", <Network className="size-3.5" />)}
					</div>
				</Toolbar>

				<div className="min-h-0 flex-1">
					{view === "board" ? (
						<NoteBoard
							notes={shown}
							positions={positions}
							edges={edges}
							activePath={selectedPath}
							onMove={moveCard}
							onOpen={openNote}
							onDelete={(path) => setDeleting(notes.find((n) => n.path === path) ?? null)}
							viewers={(path) => viewersAt("notes", rel(path))}
							awareness={board?.awareness}
							userName={myName}
							readOnly={isViewer}
						/>
					) : view === "graph" ? (
						<NoteGraph notes={shown} edges={edges} activePath={selectedPath} onOpen={openNote} />
					) : selected ? (
						contentLoading ? (
							<Loading fill className="flex-1" />
						) : (
							<NoteEditor
								key={selected.path}
								fileName={selected.name}
								initialContent={noteContent}
								onSave={(text) => handleSave(selected, text)}
								readOnly={isViewer}
								workspacePath={workspacePath}
								docId={rel(selected.path)}
								notes={notes}
								onOpenNote={openNote}
								onTextChange={(text) => shareText(selected.path, text)}
							/>
						)
					) : (
						<Welcome
							title={notes.length === 0 ? "Start your first note" : "Notes"}
							intro={<>Notes save themselves. Link with <code className="font-mono">[[Name]]</code>.</>}
							actions={[
								...(isViewer ? [] : [{ label: "New note", keys: "Ctrl N", icon: <FilePlus className="size-4" />, run: () => { setNewTitle(""); setIsNewOpen(true); } }]),
								{ label: "Go to a note", keys: "Ctrl O", icon: <Search className="size-4" />, run: () => { setSwitcherQuery(""); setSwitcher(true); } },
								...(isViewer ? [] : [{ label: "Open today’s note", keys: today(), icon: <CalendarPlus className="size-4" />, run: openToday }]),
							]}
							recentTitle="Recent Notes"
							art="notes"
							recent={notes.slice(0, 6).map((n) => ({ key: n.path, label: noteTitle(n.name), icon: <FileText className="size-4 text-muted-foreground" />, run: () => openNote(n.path) }))}
							recentEmpty="Notes you write are listed here."
							tip={"Hide the list with Ctrl \\ for more room to write."}
						/>
					)}
				</div>
			</section>

			{menu.menu}

			<Finder
				open={switcher}
				onClose={() => setSwitcher(false)}
				query={switcherQuery}
				onQueryChange={setSwitcherQuery}
				placeholder="Find a note by name"
				label="Go to note"
				items={switcherItems}
				onSubmitEmpty={() => {
					setSwitcher(false);
					if (!isViewer) void createNote(switcherQuery);
				}}
				onChoose={(item, alt) => {
					setSwitcher(false);
					if (alt && !isViewer) void createNote(switcherQuery);
					else openNote(item.id);
				}}
				renderPreview={(item) => {
					const text = liveTexts[item.id] ?? texts[item.id] ?? "";
					return (
						<div className="h-full overflow-hidden p-4">
							<h3 className="text-sm font-semibold">{item.label}</h3>
							<p className="mt-3 text-sm whitespace-pre-wrap text-muted-foreground">{text.slice(0, 700) || "This note is empty."}</p>
						</div>
					);
				}}
				empty={isViewer ? "No note matches." : <>No note matches. Press <kbd className="font-mono">Ctrl Enter</kbd> to make “{switcherQuery}”.</>}
				footer={
					<>
						<span>↑↓ move</span>
						<span>Enter open</span>
						{!isViewer && <span>Ctrl Enter new note from the text</span>}
					</>
				}
			/>

			{isNewOpen && (
				<Dialog isOpen={isNewOpen} onOpenChange={setIsNewOpen} className="max-w-md">
					<form
						onSubmit={(e) => {
							e.preventDefault();
							void createNote(newTitle);
						}}
						className="space-y-4"
					>
						<DialogHeading icon={<Plus className="size-6" />} title="New Note" />
						<Input aria-label="Note title" required value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Title" aria-invalid={!!validateFileName(newTitle)} autoFocus />
						{validateFileName(newTitle) && <p role="alert" className="text-xs text-destructive">{validateFileName(newTitle)}</p>}
						<DialogFooter className="mt-2">
							<Button type="button" variant="outline" onPress={() => setIsNewOpen(false)} isDisabled={submitting}>
								Cancel
							</Button>
							<Button type="submit" isDisabled={submitting || !newTitle.trim() || !!validateFileName(newTitle)}>
								{submitting ? "Creating…" : "Create Note"}
							</Button>
						</DialogFooter>
					</form>
				</Dialog>
			)}

			{renaming && (
				<Dialog isOpen onOpenChange={(open) => !open && setRenaming(null)} className="max-w-md">
					<form
						onSubmit={(e) => {
							e.preventDefault();
							void handleRename();
						}}
						className="space-y-4"
					>
						<DialogHeading icon={<Pencil className="size-6" />} title="Rename Note" description={<>{renaming.note.name}</>} />
						<Input aria-label="New name" value={renaming.value} onChange={(e) => setRenaming({ ...renaming, value: e.target.value })} aria-invalid={!!validateFileName(renaming.value)} autoFocus />
						{(validateFileName(renaming.value) ?? renameError) && <p role="alert" className="text-xs text-destructive">{validateFileName(renaming.value) ?? renameError}</p>}
						<DialogFooter className="mt-2">
							<Button type="button" variant="outline" onPress={() => setRenaming(null)}>
								Cancel
							</Button>
							<Button type="submit" isDisabled={!renaming.value.trim() || !!validateFileName(renaming.value)}>Rename</Button>
						</DialogFooter>
					</form>
				</Dialog>
			)}

			{deleting && (
				<Dialog isOpen onOpenChange={(open) => !open && setDeleting(null)}>
					<div className="space-y-4">
						<DialogHeading icon={<Trash2 className="size-6" />} tone="danger" title="Delete Note" description={<>Move <span className="font-semibold text-foreground">{deleting.name}</span> to the Trash? You can restore it from there.</>} />
						<DialogFooter className="mt-2">
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
