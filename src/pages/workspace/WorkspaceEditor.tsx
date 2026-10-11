import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Columns3, Command, Eye, FilePlus, FileSearch, FolderPlus, Pencil, Plus, Save, Search, Sparkles, StickyNote, Terminal, Trash2, UsersRound, X, GitBranch, History, MessageSquareDiff, Keyboard } from "@/components/animate-icons";

import CodeTabBase from "@/components/elements/editor/CodeTab";
import type { CursorInfo } from "@/components/elements/editor/CodeEditor";
import type { CodeTabHandle, CodeTabStatus } from "@/components/elements/editor/codeTabTypes";
import EditorDashboard from "@/components/elements/editor/EditorDashboard";
import EditorPanel, { type PanelTab } from "@/components/elements/editor/EditorPanel";
import type { TerminalPanelHandle } from "@/components/elements/editor/TerminalPanel";
import EditorStatusLine from "@/components/elements/editor/EditorStatusLine";
import EditorTabs from "@/components/elements/editor/EditorTabs";
import EditorToolbar from "@/components/elements/editor/EditorToolbar";
import FileExplorer from "@/components/elements/editor/FileExplorer";
import QuickOpen, { type EditorCommand } from "@/components/elements/editor/QuickOpen";
import { useContextMenu, type MenuEntry } from "@/components/elements/ContextMenu";
import MarkdownPreview from "@/components/elements/MarkdownPreview";
import Splitter from "@/components/elements/Splitter";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogHeading } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { exportFolders } from "@/lib/export";
import { useErrorLog } from "@/hooks/useErrorLog";
import { useOpenParam } from "@/hooks/useOpenParam";
import { usePanelSize } from "@/hooks/usePanelSize";
import { useReportItem } from "@/hooks/usePresence";
import { isBinaryFile, isDocumentFile, isMarkdownFile } from "@/lib/editor/languages";
import { baseName } from "@/lib/editor/fileKinds";
import type { VimCommand } from "@/lib/editor/vimSetup";
import { DEFAULT_EDITOR_PREFS, FONT_SIZE_RANGE, setEditorPrefs, useEditorPrefs } from "@/lib/editorPrefs";
import { validateFileName } from "@/lib/validation";
import { filterRecent, pushRecent, readRecent } from "@/lib/recentFiles";
import {
	createWorkspaceFile,
	createWorkspaceFolder,
	deleteWorkspaceItem,
	listWorkspaceFiles,
	openWorkspaceFile,
	renameWorkspaceItem,
	renameYjsDoc,
} from "@/lib/tauri";
import { useIsViewer, useP2P } from "@/store/p2p/P2PContext";
import { useWorkspace } from "@/store/workspace/WorkspaceContext";
import type { WorkspaceFile } from "@/types/workspace";

// Open files stay mounted while hidden, so each keeps its cursor, undo history and live connection
const CodeTab = memo(CodeTabBase);

// Folders shown in the explorer: code lives in editor, and files holds anything else worth opening here
const ROOTS = ["editor", "files", "notes"];

const toRel = (path: string) => path.replace(/^\/+/, "");

const read = (key: string, fallback: boolean) => {
	try {
		const v = localStorage.getItem(key);
		return v === null ? fallback : v === "true";
	} catch {
		return fallback;
	}
};
const remember = (key: string, value: boolean) => {
	try {
		localStorage.setItem(key, String(value));
	} catch {
		// Not remembered this time
	}
};

interface NewItemDialog {
	kind: "file" | "folder";
	dir: string;
	value: string;
}

// The Editor: an explorer, open files as tabs (optionally split in two, or beside a Markdown preview), a command palette
// and quick open, optional Vim keys, a terminal panel and a status line. Everyone in the workspace edits the same files live.
export default function WorkspaceEditor() {
	const { workspace, refreshStats, addActivityEvent } = useWorkspace();
	const isViewer = useIsViewer();
	const logError = useErrorLog();
	const navigate = useNavigate();
	const { lastSyncedFile, viewersAt } = useP2P();
	const prefs = useEditorPrefs();
	const workspacePath = workspace?.path ?? "";

	const [expanded, setExpanded] = useState<Set<string>>(new Set(["editor"]));
	const [entries, setEntries] = useState<Record<string, WorkspaceFile[]>>({});
	const [targetDir, setTargetDir] = useState("editor");
	const [tabs, setTabs] = useState<string[]>([]);
	const [active, setActive] = useState<string | null>(null);
	// The file shown in the right-hand pane when the editor is split, and the one whose pane was used last
	const [side, setSide] = useState<string | null>(null);
	const [focusPath, setFocusPath] = useState<string | null>(null);
	const current = focusPath && (focusPath === active || focusPath === side) ? focusPath : active;
	useReportItem(current);
	const [dirty, setDirty] = useState<Set<string>>(new Set());
	const [statuses, setStatuses] = useState<Record<string, CodeTabStatus>>({});
	const [cursors, setCursors] = useState<Record<string, CursorInfo>>({});
	const [texts, setTexts] = useState<Record<string, string>>({});
	const [vimMode, setVimMode] = useState("");
	const [showBlame, setShowBlame] = useState(false);
	const [preview, setPreview] = useState(false);
	const [explorerOpen, setExplorerOpen] = useState(() => read("nexsync.editor.explorer", true));
	const [showPanel, setShowPanel] = useState(() => read("nexsync.editor.panel", true));
	const [panelTab, setPanelTab] = useState<PanelTab>("terminal");
	const [explorerWidth, setExplorerWidth] = usePanelSize("editor.explorer", 288, 180, 560);
	const [panelHeight, setPanelHeight] = usePanelSize("editor.panel", 208, 96, 640);
	const [splitWidth, setSplitWidth] = usePanelSize("editor.split", 640, 240, 2400);
	const [recent, setRecent] = useState<string[]>(() => readRecent(workspacePath));
	const [quick, setQuick] = useState<{ open: boolean; initial: string; side: boolean }>({ open: false, initial: "", side: false });
	const [newItem, setNewItem] = useState<NewItemDialog | null>(null);
	const [itemError, setItemError] = useState<string | null>(null);
	const [deleting, setDeleting] = useState<WorkspaceFile | null>(null);
	const [closing, setClosing] = useState<string | null>(null);
	const [exportNotice, setExportNotice] = useState<{ ok: boolean; text: string } | null>(null);
	const [renaming, setRenaming] = useState<{ entry: WorkspaceFile; value: string } | null>(null);
	const { open: openMenu, menu } = useContextMenu();
	const handles = useRef(new Map<string, CodeTabHandle | null>());
	const handleRefs = useRef(new Map<string, (h: CodeTabHandle | null) => void>());

	const loadDir = useCallback(
		async (dir: string) => {
			if (!workspacePath) return;
			const list = await listWorkspaceFiles(workspacePath, dir).catch(() => []);
			setEntries((prev) => ({ ...prev, [dir]: list }));
		},
		[workspacePath],
	);

	// Load the roots and every open folder, and again when a collaborator's changes arrive
	useEffect(() => {
		for (const dir of new Set([...ROOTS, ...expanded])) void loadDir(dir);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [loadDir, expanded, lastSyncedFile]);

	// Load every folder under the roots, so the explorer filter can search files that are not expanded
	const loadTree = useCallback(async () => {
		if (!workspacePath) return;
		const queue = [...ROOTS];
		const found: Record<string, WorkspaceFile[]> = {};
		for (let loaded = 0; queue.length > 0 && loaded < 300; loaded++) {
			const dir = queue.shift()!;
			found[dir] = await listWorkspaceFiles(workspacePath, dir).catch(() => []);
			for (const entry of found[dir]) if (entry.is_dir) queue.push(toRel(entry.path));
		}
		setEntries((prev) => ({ ...prev, ...found }));
		// Once the whole tree is known, files that no longer exist (deleted or renamed, here or elsewhere) leave the recent list
		if (queue.length === 0) {
			const exists = new Set(Object.values(found).flat().filter((e) => !e.is_dir).map((e) => toRel(e.path)));
			setRecent(filterRecent(workspacePath, (p) => exists.has(p)));
		}
	}, [workspacePath]);

	const refresh = () => {
		for (const dir of new Set([...ROOTS, ...expanded])) void loadDir(dir);
	};

	const openPath = useCallback(
		(rel: string, options?: { side?: boolean }) => {
			const name = rel.split("/").pop() ?? rel;
			if (isBinaryFile(name) || isDocumentFile(name)) {
				openWorkspaceFile(workspacePath, rel).catch((err) => logError(err, { source: "editor", workspace: workspacePath }));
				return;
			}
			setTabs((prev) => (prev.includes(rel) ? prev : [...prev, rel]));
			if (options?.side && rel !== active) setSide(rel);
			else {
				setActive(rel);
				setFocusPath(rel);
				setSide((s) => (s === rel ? null : s));
			}
			setRecent(pushRecent(workspacePath, rel));
		},
		[workspacePath, logError, active],
	);

	useOpenParam((path) => openPath(toRel(path)), !!workspacePath);

	// window.confirm is unreliable in the desktop webview, so unsaved tabs ask in a dialog
	const closeTab = (path: string) => {
		if (dirty.has(path)) return setClosing(path);
		discardTab(path);
	};

	const discardTab = (path: string) => {
		setClosing(null);
		setSide((s) => (s === path ? null : s));
		setTabs((prev) => {
			const next = prev.filter((p) => p !== path);
			setActive((current) => (current === path ? (next[Math.max(0, prev.indexOf(path) - 1)] ?? null) : current));
			return next;
		});
		setDirty((prev) => {
			const next = new Set(prev);
			next.delete(path);
			return next;
		});
	};

	const onDirtyChange = useCallback((path: string, isDirty: boolean) => {
		setDirty((prev) => {
			if (prev.has(path) === isDirty) return prev;
			const next = new Set(prev);
			if (isDirty) next.add(path);
			else next.delete(path);
			return next;
		});
	}, []);

	const toggleDir = (dir: string) => {
		setTargetDir(dir);
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(dir)) next.delete(dir);
			else next.add(dir);
			return next;
		});
	};

	const createItem = async () => {
		if (!newItem || !workspacePath) return;
		const name = newItem.value.trim();
		if (!name) return setItemError("Name is required.");
		const problem = validateFileName(name);
		if (problem) return setItemError(problem);
		try {
			if (newItem.kind === "file") {
				await createWorkspaceFile(workspacePath, newItem.dir, name);
				openPath(`${newItem.dir}/${name}`);
			} else {
				await createWorkspaceFolder(workspacePath, newItem.dir, name);
				setExpanded((prev) => new Set(prev).add(newItem.dir));
			}
			await loadDir(newItem.dir);
			void refreshStats();
			setNewItem(null);
		} catch (err) {
			setItemError(err instanceof Error ? err.message : String(err));
		}
	};

	const renameItem = async () => {
		if (!renaming || !workspacePath) return;
		const { entry } = renaming;
		const name = renaming.value.trim();
		if (!name) return setItemError("Name is required.");
		const problem = validateFileName(name);
		if (problem) return setItemError(problem);
		if (name === entry.name) return setRenaming(null);
		const rel = toRel(entry.path);
		const inside = (p: string) => p === rel || p.startsWith(`${rel}/`);
		// An open file with unsaved changes would come back from disk without them under its new name
		if (tabs.some((p) => inside(p) && dirty.has(p))) {
			return setItemError("Save or close the open files with unsaved changes first.");
		}
		try {
			await renameWorkspaceItem(workspacePath, rel, name);
			const parent = rel.split("/").slice(0, -1).join("/");
			const moved = (p: string) => `${parent}/${name}${p.slice(rel.length)}`;
			// Open files keep their shared editing state under the new name
			for (const p of tabs.filter(inside)) void renameYjsDoc(workspacePath, p, moved(p)).catch(() => {});
			setTabs((prev) => prev.map((p) => (inside(p) ? moved(p) : p)));
			setActive((current) => (current && inside(current) ? moved(current) : current));
			setExpanded((prev) => new Set([...prev].map((p) => (inside(p) ? moved(p) : p))));
			setTargetDir((current) => (inside(current) ? moved(current) : current));
			setEntries((prev) => Object.fromEntries(Object.entries(prev).filter(([dir]) => !inside(dir))));
			addActivityEvent("Renamed item", `Renamed ${entry.name} to ${name}`, `/${parent}/${name}`, entry.is_dir ? "folder" : "file");
			await loadDir(parent);
			void refreshStats();
			setRenaming(null);
		} catch (err) {
			setItemError(err instanceof Error ? err.message : String(err));
		}
	};

	const deleteItem = async () => {
		if (!deleting || !workspacePath) return;
		const rel = toRel(deleting.path);
		try {
			await deleteWorkspaceItem(workspacePath, rel);
			setRecent(filterRecent(workspacePath, (p) => p !== rel && !p.startsWith(`${rel}/`)));
			setTabs((prev) => prev.filter((p) => p !== rel && !p.startsWith(`${rel}/`)));
			setActive((current) => (current && (current === rel || current.startsWith(`${rel}/`)) ? null : current));
			await loadDir(rel.split("/").slice(0, -1).join("/"));
			void refreshStats();
			setDeleting(null);
		} catch (err) {
			logError(err, { source: "editor", workspace: workspacePath });
		}
	};


	const handleOf = (path: string | null) => (path ? handles.current.get(path) ?? undefined : undefined);
	const refFor = (path: string) => {
		let fn = handleRefs.current.get(path);
		if (!fn) {
			fn = (h) => void handles.current.set(path, h);
			handleRefs.current.set(path, fn);
		}
		return fn;
	};

	const onStatus = useCallback((path: string, status: CodeTabStatus) => setStatuses((prev) => (JSON.stringify(prev[path]) === JSON.stringify(status) ? prev : { ...prev, [path]: status })), []);
	const onCursor = useCallback((path: string, info: CursorInfo) => setCursors((prev) => ({ ...prev, [path]: info })), []);
	const onText = useCallback((path: string, text: string) => setTexts((prev) => (prev[path] === text ? prev : { ...prev, [path]: text })), []);

	// A file that is open beside the current one, or the preview of a Markdown file, takes the right-hand pane
	const sideOpen = side !== null && side !== active && tabs.includes(side);
	const canPreview = !!active && isMarkdownFile(active);
	const previewOpen = preview && canPreview && !sideOpen;

	const toggleExplorer = () => setExplorerOpen((v) => (remember("nexsync.editor.explorer", !v), !v));
	const terminalRef = useRef<TerminalPanelHandle>(null);
	const newTerminal = () => {
		togglePanel("terminal");
		terminalRef.current?.newTerminal();
	};
	const togglePanel = (tab?: PanelTab) => {
		if (tab && (!showPanel || panelTab !== tab)) {
			setPanelTab(tab);
			if (!showPanel) {
				setShowPanel(true);
				remember("nexsync.editor.panel", true);
			}
			return;
		}
		setShowPanel((v) => (remember("nexsync.editor.panel", !v), !v));
	};
	const toggleSide = () => {
		if (sideOpen) return setSide(null);
		const other = tabs.find((t) => t !== active);
		if (other) {
			setSide(other);
			setPreview(false);
		} else setQuick({ open: true, initial: "", side: true });
	};

	const files = useMemo(() => Object.values(entries).flat().filter((e) => !e.is_dir).map((e) => toRel(e.path)).filter((p) => !isBinaryFile(baseName(p)) && !isDocumentFile(baseName(p))), [entries]);
	const openQuick = (initial = "", asSide = false) => {
		void loadTree();
		setQuick({ open: true, initial, side: asSide });
	};

	const cycle = (step: number) => {
		if (tabs.length < 2 || !active) return;
		const next = tabs[(tabs.indexOf(active) + step + tabs.length) % tabs.length];
		setActive(next);
		setFocusPath(next);
	};

	// What a person typing Vim commands can ask for
	const vimRun = (command: VimCommand) => {
		const target = current;
		switch (command) {
			case "write":
				return void handleOf(target)?.save();
			case "quit":
				return target ? closeTab(target) : undefined;
			case "writeQuit":
				return void handleOf(target)?.save().then(() => target && discardTab(target));
			case "files":
				return openQuick();
			case "commands":
				return openQuick(">");
			case "explorer":
				return toggleExplorer();
			case "nextTab":
				return cycle(1);
			case "prevTab":
				return cycle(-1);
			case "closeTab":
				return target ? closeTab(target) : undefined;
			case "split":
				return toggleSide();
			case "panel":
				return togglePanel();
			case "preview":
				return canPreview && setPreview((v) => !v);
		}
	};
	const vimRef = useRef(vimRun);
	vimRef.current = vimRun;
	const onVimCommand = useCallback((command: VimCommand) => vimRef.current(command), []);

	// Newest first: after the file just closed, the one beside it takes over
	const closeOthers = (keep: string) => {
		for (const t of tabs.filter((p) => p !== keep)) if (!dirty.has(t)) discardTab(t);
		setActive(keep);
	};

	const commands: EditorCommand[] = [
		{ id: "quick", group: "Go", label: "Go to file…", hint: "Ctrl P", icon: <FileSearch className="size-4" />, run: () => openQuick() },
		{ id: "line", group: "Go", label: "Go to line…", hint: "Ctrl G", icon: <Keyboard className="size-4" />, run: () => openQuick(":") },
		{ id: "notes", group: "Go", label: "Open notes", icon: <StickyNote className="size-4" />, run: () => navigate("/workspace/notes") },
		...(isViewer ? [] : [{ id: "new-file", group: "File", label: "New file", hint: "Ctrl N", icon: <FilePlus className="size-4" />, run: () => { setItemError(null); setNewItem({ kind: "file", dir: targetDir, value: "" }); } }, { id: "new-folder", group: "File", label: "New folder", icon: <FolderPlus className="size-4" />, run: () => { setItemError(null); setNewItem({ kind: "folder", dir: targetDir, value: "" }); } }]),
		{ id: "save", group: "File", label: "Save", hint: "Ctrl S", icon: <Save className="size-4" />, run: () => void handleOf(current)?.save() },
		{ id: "close", group: "File", label: "Close tab", hint: "Ctrl W", icon: <X className="size-4" />, run: () => current && closeTab(current) },
		{ id: "close-others", group: "File", label: "Close other tabs", run: () => current && closeOthers(current) },
		{ id: "close-all", group: "File", label: "Close all tabs", run: () => tabs.filter((t) => !dirty.has(t)).forEach(discardTab) },
		{ id: "copy-path", group: "File", label: "Copy path of this file", run: () => current && void navigator.clipboard?.writeText(current) },
		{ id: "explorer", group: "View", label: "Toggle explorer", hint: "Ctrl B", icon: <FolderPlus className="size-4" />, run: toggleExplorer },
		{ id: "terminal", group: "View", label: "Toggle terminal", hint: "Ctrl J", icon: <Terminal className="size-4" />, run: () => togglePanel("terminal") },
		{ id: "new-terminal", group: "View", label: "New terminal", hint: "Ctrl Shift `", icon: <Terminal className="size-4" />, run: newTerminal },
		{ id: "output", group: "View", label: "Show run output", icon: <Terminal className="size-4" />, run: () => togglePanel("output") },
		{ id: "problems", group: "View", label: "Show problems", icon: <AlertTriangle className="size-4" />, run: () => togglePanel("problems") },
		{ id: "split", group: "View", label: sideOpen ? "Close the split" : "Open to the side", hint: "Ctrl \\", icon: <Columns3 className="size-4" />, run: toggleSide },
		{ id: "preview", group: "View", label: previewOpen ? "Hide Markdown preview" : "Show Markdown preview", hint: "Ctrl Shift V", icon: <Eye className="size-4" />, run: () => canPreview && setPreview((v) => !v) },
		{ id: "blame", group: "View", label: showBlame ? "Hide blame" : "Show blame", icon: <UsersRound className="size-4" />, run: () => setShowBlame((v) => !v) },
		{ id: "zoom-in", group: "View", label: "Larger text", hint: "Ctrl +", run: () => setEditorPrefs({ fontSize: Math.min(FONT_SIZE_RANGE.max, prefs.fontSize + 1) }) },
		{ id: "zoom-out", group: "View", label: "Smaller text", hint: "Ctrl -", run: () => setEditorPrefs({ fontSize: Math.max(FONT_SIZE_RANGE.min, prefs.fontSize - 1) }) },
		{ id: "zoom-reset", group: "View", label: "Reset text size", run: () => setEditorPrefs({ fontSize: DEFAULT_EDITOR_PREFS.fontSize }) },
		{ id: "vim", group: "Editor", label: prefs.vim ? "Turn off Vim keys" : "Turn on Vim keys", icon: <Keyboard className="size-4" />, run: () => setEditorPrefs({ vim: !prefs.vim }) },
		{ id: "wrap", group: "Editor", label: prefs.wrap ? "Do not wrap long lines" : "Wrap long lines", hint: "Alt Z", run: () => setEditorPrefs({ wrap: !prefs.wrap }) },
		{ id: "relative", group: "Editor", label: prefs.relativeNumbers ? "Number lines from the top" : "Number lines from the cursor", run: () => setEditorPrefs({ relativeNumbers: !prefs.relativeNumbers }) },
		{ id: "minimap", group: "Editor", label: prefs.minimap ? "Hide minimap" : "Show minimap", run: () => setEditorPrefs({ minimap: !prefs.minimap }) },
		{ id: "find", group: "Editor", label: "Find in file", hint: "Ctrl F", icon: <Search className="size-4" />, run: () => handleOf(current)?.find() },
		...(statuses[current ?? ""]?.canFormat ? [{ id: "format", group: "Editor", label: "Format file", hint: "Shift Alt F", icon: <Sparkles className="size-4" />, run: () => void handleOf(current)?.format() }] : []),
		{ id: "history", group: "Editor", label: "Show file history", icon: <History className="size-4" />, run: () => handleOf(current)?.history() },
		...(statuses[current ?? ""]?.hasBranches ? [{ id: "branches", group: "Editor", label: "Branches of this file", icon: <GitBranch className="size-4" />, run: () => handleOf(current)?.branches() }] : []),
		...(statuses[current ?? ""]?.canSuggest ? [{ id: "suggest", group: "Editor", label: "Suggest an edit", icon: <MessageSquareDiff className="size-4" />, run: () => handleOf(current)?.suggest() }] : []),
		{ id: "palette", group: "Go", label: "Command palette", hint: "Ctrl Shift P", icon: <Command className="size-4" />, run: () => openQuick(">") },
	];

	// Keyboard: the shortcuts people know from VS Code. With Vim keys on, the ones Vim uses itself (Ctrl+B, Ctrl+W, Ctrl+G…) are left to Vim,
	// and Space-prefixed commands stand in for them.
	const shortcutsRef = useRef<(e: KeyboardEvent) => void>(() => {});
	shortcutsRef.current = (e) => {
		const mod = e.ctrlKey || e.metaKey;
		const key = e.key.toLowerCase();
		if (e.altKey && !mod && /^[1-9]$/.test(e.key)) {
			const target = tabs[Number(e.key) - 1];
			if (target) {
				e.preventDefault();
				setActive(target);
				setFocusPath(target);
			}
			return;
		}
		if (e.altKey && !mod && key === "z") {
			e.preventDefault();
			return setEditorPrefs({ wrap: !prefs.wrap });
		}
		if (e.altKey && e.shiftKey && key === "f") {
			e.preventDefault();
			return void handleOf(current)?.format();
		}
		if (!mod) return;
		const inVim = vimMode !== "" && !!(e.target as HTMLElement)?.closest?.(".cm-editor");
		const vimOwns = new Set(["b", "w", "g", "n", "j", "\\"]);
		if (inVim && vimOwns.has(key) && !e.shiftKey) return;
		if (key === "p") {
			e.preventDefault();
			return e.shiftKey ? openQuick(">") : openQuick();
		}
		if (key === "g" && !e.shiftKey) {
			e.preventDefault();
			return openQuick(":");
		}
		if (key === "b" && !e.shiftKey) {
			e.preventDefault();
			return toggleExplorer();
		}
		if (e.shiftKey && (e.key === "`" || e.key === "~")) {
			e.preventDefault();
			return newTerminal();
		}
		if ((key === "j" || e.key === "`") && !e.shiftKey) {
			e.preventDefault();
			return togglePanel();
		}
		if (key === "w" && !e.shiftKey && current) {
			e.preventDefault();
			return closeTab(current);
		}
		if (key === "n" && !e.shiftKey && !isViewer) {
			e.preventDefault();
			setItemError(null);
			return setNewItem({ kind: "file", dir: targetDir, value: "" });
		}
		if (key === "\\") {
			e.preventDefault();
			return toggleSide();
		}
		if (key === "v" && e.shiftKey && canPreview) {
			e.preventDefault();
			return setPreview((v) => !v);
		}
		if (e.key === "Tab" || e.key === "PageDown" || e.key === "PageUp") {
			e.preventDefault();
			return cycle(e.key === "PageUp" || e.shiftKey ? -1 : 1);
		}
		if ((e.key === "=" || e.key === "+") && !inVim) {
			e.preventDefault();
			return setEditorPrefs({ fontSize: Math.min(FONT_SIZE_RANGE.max, prefs.fontSize + 1) });
		}
		if (e.key === "-" && !inVim) {
			e.preventDefault();
			return setEditorPrefs({ fontSize: Math.max(FONT_SIZE_RANGE.min, prefs.fontSize - 1) });
		}
	};
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => shortcutsRef.current(e);
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	// The file shown takes the keyboard when it changes
	useEffect(() => {
		if (current) handleOf(current)?.focus();
	}, [current]); // eslint-disable-line react-hooks/exhaustive-deps

	const tabMenu = (e: React.MouseEvent, path: string): void =>
		openMenu(e, [
			{ label: "Close", shortcut: "Ctrl+W", onSelect: () => closeTab(path) },
			{ label: "Close others", onSelect: () => closeOthers(path) },
			{ label: "Close all", onSelect: () => tabs.filter((t) => !dirty.has(t)).forEach(discardTab) },
			"separator",
			{ label: "Open to the side", shortcut: "Ctrl+\\", disabled: path === active && tabs.length < 2, onSelect: () => (path === active ? toggleSide() : (setSide(path), setPreview(false))) },
			{ label: "Copy path", onSelect: () => void navigator.clipboard?.writeText(path) },
		] as MenuEntry[]);

	const reorder = (from: number, to: number) =>
		setTabs((prev) => {
			const next = [...prev];
			const [moved] = next.splice(from, 1);
			next.splice(to, 0, moved);
			return next;
		});

	const rightPath = sideOpen ? side : null;
	const columns = rightPath || previewOpen ? `${Math.max(splitWidth, 240)}px 1px minmax(0,1fr)` : "minmax(0,1fr)";
	const currentStatus = current ? statuses[current] : undefined;
	const rightText = previewOpen && active ? texts[active] ?? "" : "";
	const noteRefs = useMemo(() => [], []);
	const problemLines = active ? statuses[active]?.problemLines ?? [] : [];
	const mdTextHandler = useCallback((path: string, text: string) => onText(path, text), [onText]);

	return (
		<div className="flex h-full min-h-0 flex-col bg-background">
			<div className="flex min-h-0 flex-1">
				{explorerOpen && (
					<>
						<div style={{ width: explorerWidth }} className="min-w-0 shrink-0">
							<FileExplorer
								roots={ROOTS}
								entries={entries}
								expanded={expanded}
								targetDir={targetDir}
								activePath={current}
								openPaths={tabs}
								dirtyPaths={dirty}
								readOnly={isViewer}
								viewers={(rel) => viewersAt("editor", rel)}
								onToggleDir={toggleDir}
								onOpenFile={openPath}
								onOpenSide={(rel) => openPath(rel, { side: true })}
								onCopyPath={(rel) => void navigator.clipboard?.writeText(rel)}
								onNew={(kind, dir) => {
									setItemError(null);
									setNewItem({ kind, dir, value: "" });
								}}
								onRename={(entry) => {
									setItemError(null);
									setRenaming({ entry, value: entry.name });
								}}
								onDelete={setDeleting}
								onRefresh={refresh}
								onCollapseAll={() => {
									setExpanded(new Set());
									setTargetDir("editor");
								}}
								onFilterStart={() => void loadTree()}
								notice={exportNotice}
								onExport={async () => {
									setExportNotice(null);
									try {
										const name = `${workspace?.name ?? "workspace"}-${targetDir.replace(/\//g, "-")}`;
										const result = await exportFolders(workspacePath, [targetDir], name);
										if (result) setExportNotice({ ok: true, text: `Saved ${result.count} ${result.count === 1 ? "file" : "files"} to ${result.dest}` });
									} catch (err) {
										setExportNotice({ ok: false, text: err instanceof Error ? err.message : String(err) });
									}
								}}
							/>
						</div>
						<Splitter orientation="vertical" grows="right" size={explorerWidth} onResize={setExplorerWidth} label="Resize the explorer" />
					</>
				)}

				<div className="flex min-w-0 flex-1 flex-col">
					<div className="flex shrink-0 items-stretch border-b bg-card/40">
						<EditorTabs
							tabs={tabs}
							active={active}
							side={sideOpen ? side : null}
							dirty={dirty}
							onSelect={(path) => {
								if (path === side) setSide(active);
								setActive(path);
								setFocusPath(path);
							}}
							onClose={closeTab}
							onReorder={reorder}
							onContextMenu={tabMenu}
						/>
					</div>
					<EditorToolbar
						path={current}
						status={currentStatus}
						handle={handleOf(current)}
						explorerOpen={explorerOpen}
						onToggleExplorer={toggleExplorer}
						showBlame={showBlame}
						onToggleBlame={() => setShowBlame((v) => !v)}
						split={sideOpen}
						onToggleSplit={toggleSide}
						canPreview={canPreview}
						preview={previewOpen}
						onTogglePreview={() => {
							setSide(null);
							setPreview((v) => !v);
						}}
						panelOpen={showPanel}
						onTogglePanel={() => togglePanel()}
					/>

					<div className="relative min-h-0 flex-1">
						{tabs.length === 0 && (
							<EditorDashboard
								workspaceName={workspace?.name ?? ""}
								recent={recent}
								readOnly={isViewer}
								onOpen={(path) => openPath(path)}
								onQuickOpen={() => openQuick()}
								onCommands={() => openQuick(">")}
								onNewFile={() => {
									setItemError(null);
									setNewItem({ kind: "file", dir: targetDir, value: "" });
								}}
								onTogglePanel={() => togglePanel()}
								onNotes={() => navigate("/workspace/notes")}
							/>
						)}
						<div className="grid h-full min-h-0" style={{ gridTemplateColumns: columns, gridTemplateRows: "minmax(0,1fr)", display: tabs.length === 0 ? "none" : undefined }}>
							{tabs.map((path) => {
								const column = path === active ? 1 : path === rightPath ? 3 : 0;
								return (
									<div key={path} onFocusCapture={() => setFocusPath(path)} style={{ gridColumn: column || 1, gridRow: 1, display: column ? undefined : "none" }} className="min-h-0 min-w-0">
										<CodeTab
											ref={refFor(path)}
											path={path}
											active={column !== 0}
											readOnly={isViewer}
											showBlame={showBlame && path === current}
											onDirtyChange={onDirtyChange}
											onStatus={onStatus}
											onCursor={onCursor}
											onText={previewOpen && path === active ? mdTextHandler : undefined}
											onVimMode={setVimMode}
											onVimCommand={onVimCommand}
										/>
									</div>
								);
							})}
							{(rightPath || previewOpen) && <Splitter orientation="vertical" grows="right" size={splitWidth} onResize={setSplitWidth} label="Resize the split" className="[grid-column:2] [grid-row:1]" />}
							{previewOpen && (
								<div style={{ gridColumn: 3, gridRow: 1 }} className="min-h-0 min-w-0 border-l bg-background">
									<MarkdownPreview text={rightText} notes={noteRefs} />
								</div>
							)}
						</div>
					</div>

					{/* Always mounted, so the shells in the terminal keep running while the panel is hidden */}
					<div className={showPanel ? "contents" : "hidden"}>
						<Splitter orientation="horizontal" grows="up" size={panelHeight} onResize={setPanelHeight} label="Resize the panel" />
						<div style={{ height: panelHeight }} className="shrink-0">
							<EditorPanel
								ref={terminalRef}
								open={showPanel}
								tab={panelTab}
								onTab={setPanelTab}
								onClose={() => togglePanel()}
								workspacePath={workspacePath}
								activePath={current}
								problemLines={current ? statuses[current]?.problemLines ?? problemLines : []}
								onGoToLine={(line) => handleOf(current)?.goToLine(line)}
							/>
						</div>
					</div>
				</div>
			</div>

			<EditorStatusLine
				mode={prefs.vim ? vimMode : ""}
				path={current}
				status={currentStatus}
				cursor={current ? cursors[current] : undefined}
				viewers={current ? viewersAt("editor", current) : []}
				tabSize={prefs.tabSize}
				onProblems={() => togglePanel("problems")}
			/>

			<QuickOpen
				open={quick.open}
				initialQuery={quick.initial}
				onClose={() => setQuick((q) => ({ ...q, open: false }))}
				workspacePath={workspacePath}
				files={files}
				recent={recent}
				commands={commands}
				onOpenFile={(path, asSide) => openPath(path, { side: asSide || quick.side })}
				onGoToLine={(line) => handleOf(current)?.goToLine(line)}
				hasFile={!!current}
			/>
			{menu}

			{newItem && (
				<Dialog isOpen onOpenChange={(open) => !open && setNewItem(null)} className="max-w-md">
					<form
						className="space-y-4"
						onSubmit={(e) => {
							e.preventDefault();
							void createItem();
						}}
					>
						<DialogHeading icon={<Plus className="size-6" />} title={`New ${newItem.kind === "file" ? "file" : "folder"}`} description={<>Created in /{newItem.dir}/</>} />
						<Input
							aria-label={newItem.kind === "file" ? "File name" : "Folder name"}
							value={newItem.value}
							onChange={(e) => setNewItem({ ...newItem, value: e.target.value })}
							placeholder={newItem.kind === "file" ? "e.g. main.py" : "e.g. src"}
							aria-invalid={!!validateFileName(newItem.value)}
							autoFocus
						/>
						{(validateFileName(newItem.value) ?? itemError) && <p role="alert" className="text-xs text-destructive">{validateFileName(newItem.value) ?? itemError}</p>}
						<DialogFooter>
							<Button type="button" variant="outline" onPress={() => setNewItem(null)}>
								Cancel
							</Button>
							<Button type="submit" isDisabled={!newItem.value.trim() || !!validateFileName(newItem.value)}>Create</Button>
						</DialogFooter>
					</form>
				</Dialog>
			)}

			{renaming && (
				<Dialog isOpen onOpenChange={(open) => !open && setRenaming(null)} className="max-w-md">
					<form
						className="space-y-4"
						onSubmit={(e) => {
							e.preventDefault();
							void renameItem();
						}}
					>
						<DialogHeading icon={<Pencil className="size-6" />} title={`Rename ${renaming.entry.is_dir ? "folder" : "file"}`} description={<>{toRel(renaming.entry.path)}</>} />
						<Input
							value={renaming.value}
							onChange={(e) => setRenaming({ ...renaming, value: e.target.value })}
							aria-label="New name"
							aria-invalid={!!validateFileName(renaming.value)}
							autoFocus
						/>
						{(validateFileName(renaming.value) ?? itemError) && <p role="alert" className="text-xs text-destructive">{validateFileName(renaming.value) ?? itemError}</p>}
						<DialogFooter>
							<Button type="button" variant="outline" onPress={() => setRenaming(null)}>
								Cancel
							</Button>
							<Button type="submit" isDisabled={!renaming.value.trim() || !!validateFileName(renaming.value)}>Rename</Button>
						</DialogFooter>
					</form>
				</Dialog>
			)}

			{closing && (
				<Dialog isOpen onOpenChange={(open) => !open && setClosing(null)}>
					<div className="space-y-4">
						<DialogHeading icon={<AlertTriangle className="size-6" />} tone="warning" title="Unsaved changes" description={<><span className="font-semibold text-foreground">{closing.split("/").pop()}</span> has changes that are
								not saved to the file. Close it anyway?</>} />
						<DialogFooter>
							<Button variant="outline" onPress={() => setClosing(null)}>
								Keep open
							</Button>
							<Button variant="destructive" onPress={() => discardTab(closing)}>
								Close
							</Button>
						</DialogFooter>
					</div>
				</Dialog>
			)}

			{deleting && (
				<Dialog isOpen onOpenChange={(open) => !open && setDeleting(null)}>
					<div className="space-y-4">
						<DialogHeading icon={<Trash2 className="size-6" />} tone="danger" title={`Delete ${deleting.is_dir ? "folder" : "file"}`} description={<>Move <span className="font-semibold text-foreground">{deleting.name}</span> to the Trash? You can
								restore it from there.</>} />
						<DialogFooter>
							<Button variant="outline" onPress={() => setDeleting(null)}>
								Cancel
							</Button>
							<Button variant="destructive" onPress={() => void deleteItem()}>
								Delete
							</Button>
						</DialogFooter>
					</div>
				</Dialog>
			)}
		</div>
	);
}
