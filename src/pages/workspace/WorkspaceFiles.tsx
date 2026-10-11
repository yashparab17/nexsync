// React
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

// Icons
import { Loader2 } from "lucide-react";
import { ChevronRight, ChevronUp, ExternalLink, FilePlus, FolderPlus, History, LayoutGrid, ListFilter, Pencil, Plus, RefreshCw, Search, Trash2, X } from "@/components/animate-icons";

// Components
import FileHistoryDialog from "@/components/dialogs/workspace/FileHistoryDialog";
import { useContextMenu, type MenuEntry } from "@/components/elements/ContextMenu";
import FileKindIcon, { FolderKindIcon } from "@/components/elements/editor/FileKindIcon";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogFooter, DialogHeading } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Context
import { useWorkspace } from "@/store/workspace/WorkspaceContext";
import { useP2P, useIsViewer } from "@/store/p2p/P2PContext";

// Hooks
import { useErrorLog } from "@/hooks/useErrorLog";
import { useOpenParam } from "@/hooks/useOpenParam";
import { validateFileName } from "@/lib/validation";
import { editorRouteFor } from "@/lib/editor/languages";

// Tauri IPC
import {
	createWorkspaceFile,
	createWorkspaceFolder,
	deleteWorkspaceItem,
	listWorkspaceFiles,
	openWorkspaceFile,
	renameWorkspaceItem,
	renameYjsDoc,
} from "@/lib/tauri";

// Types
import type { WorkspaceFile } from "@/types/workspace";
import Loading from "@/components/Loading";

// ────────────────────────────
// Helpers
// ────────────────────────────

// Formats a byte count into a human-readable size string
function formatSize(bytes: number): string {
	if (bytes === 0) return "Empty";
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Formats an ISO-8601 timestamp as a locale date and time
function formatDate(iso: string): string {
	if (!iso) return "—";
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "—";
	// The year only when it is not this one
	return date.toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		...(date.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }),
		hour: "numeric",
		minute: "2-digit",
	});
}

// Strips leading slash from entry path (e.g. /files/a.md -> files/a.md)
function toRelPath(entryPath: string): string {
	return entryPath.replace(/^\/+/, "");
}

// Joins directory and file name into a relative path
function joinRelPath(currentDir: string, name: string): string {
	return currentDir ? `${currentDir}/${name}` : name;
}

// Splits current directory into breadcrumb segments
function getBreadcrumbs(currentDir: string): string[] {
	return currentDir ? currentDir.split("/") : [];
}

// Gets the parent directory of a relative path
function getParentDir(relPath: string): string {
	const parts = relPath.split("/");
	parts.pop();
	return parts.join("/");
}

type SortKey = "name" | "modified" | "size" | "kind";
type ViewMode = "list" | "grid";

// What kind of thing an entry is, as a word: "Folder", "PY file"
function kindOf(entry: WorkspaceFile): string {
	if (entry.is_dir) return "Folder";
	const dot = entry.name.lastIndexOf(".");
	return dot > 0 ? `${entry.name.slice(dot + 1).toUpperCase()} file` : "File";
}

const readView = (): ViewMode => {
	try {
		return localStorage.getItem("nexsync.files.view") === "grid" ? "grid" : "list";
	} catch {
		return "list";
	}
};

// ────────────────────────────
// Name Dialog State
// ────────────────────────────

interface NameDialogState {
	mode: "create" | "rename";
	kind: "file" | "folder";
	item?: WorkspaceFile;
	value: string;
}

// ────────────────────────────
// Main component
// ────────────────────────────

// File manager page for browsing, creating, editing, and deleting files
export default function WorkspaceFiles() {
	const { workspace, refreshStats, addActivityEvent } = useWorkspace();
	const isViewer = useIsViewer();
	const logError = useErrorLog();

	const workspacePath = workspace?.path ?? "";

	// Navigation state
	const [currentDir, setCurrentDir] = useState("");
	const [entries, setEntries] = useState<WorkspaceFile[]>([]);
	const [isLoading, setIsLoading] = useState(true);

	const navigate = useNavigate();

	// Modal dialog state
	const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null);
	const [nameError, setNameError] = useState<string | null>(null);
	const [isNameSubmitting, setIsNameSubmitting] = useState(false);
	const [deleteItem, setDeleteItem] = useState<WorkspaceFile | null>(null);
	const [historyItem, setHistoryItem] = useState<WorkspaceFile | null>(null);
	const [isDeleting, setIsDeleting] = useState(false);

	// How the listing looks: sorted, filtered, as a list or tiles, with one entry selected
	const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "name", desc: false });
	const [view, setViewState] = useState<ViewMode>(readView);
	const [filter, setFilter] = useState("");
	const [selected, setSelected] = useState<string | null>(null);
	const menu = useContextMenu();
	const listRef = useRef<HTMLUListElement>(null);
	const setView = (next: ViewMode) => {
		setViewState(next);
		try {
			localStorage.setItem("nexsync.files.view", next);
		} catch {
			// Not remembered this time
		}
	};

	// Load directory entries from backend
	const loadEntries = useCallback(async () => {
		if (!workspacePath) return;
		setIsLoading(true);
		try {
			const relDir = currentDir;
			const next = await listWorkspaceFiles(workspacePath, relDir);
			setEntries(next);
		} catch (err) {
			logError(err, {
				source: "files",
				workspace: workspacePath,
			});
			setEntries([]);
		} finally {
			setIsLoading(false);
		}
	}, [workspacePath, currentDir, logError]);

	// Fetch entries on directory change
	useEffect(() => {
		void loadEntries();
	}, [loadEntries]);

	// Reload the listing when a collaborator's changes arrive
	const { lastSyncedFile } = useP2P();
	useEffect(() => {
		if (lastSyncedFile) void loadEntries();
	}, [lastSyncedFile]);

	// Navigate into a sub-directory
	const navigateToDir = useCallback((dir: string) => {
		setCurrentDir(dir);
	}, []);

	// Open a file where it belongs: text documents in Notes, code in the Editor tab, everything else in its own app
	const handleOpenEntry = useCallback(
		async (entry: WorkspaceFile) => {
			if (!workspacePath || entry.is_dir) return;

			const relPath = toRelPath(entry.path);
			let target = editorRouteFor(entry.name);
			// Notes lists only the top level of the notes and files folders, so deeper documents open as text in the Editor
			if (target === "notes" && !/^(notes|files)\/[^/]+$/.test(relPath)) target = "editor";

			if (target === "system") {
				try {
					await openWorkspaceFile(workspacePath, relPath);
				} catch (err) {
					logError(err, { source: "files", workspace: workspacePath });
				}
				return;
			}
			navigate(`/workspace/${target}?open=${encodeURIComponent(`/${relPath}`)}`);
		},
		[workspacePath, logError, navigate],
	);

	// Deep link from workspace search: jump to the file's folder and open it
	useOpenParam((path) => {
		const rel = toRelPath(path);
		setCurrentDir(rel.split("/").slice(0, -1).join("/"));
		void handleOpenEntry({ name: rel.split("/").pop() ?? rel, path, is_dir: false, size: 0, modified_at: "" });
	}, !!workspacePath);

	// Open dialog to create file or folder
	const openCreateDialog = useCallback((kind: "file" | "folder") => {
		setNameDialog({ mode: "create", kind, value: "" });
		setNameError(null);
	}, []);

	// Open dialog to rename an existing item
	const openRenameDialog = useCallback((item: WorkspaceFile) => {
		setNameDialog({
			mode: "rename",
			kind: item.is_dir ? "folder" : "file",
			item,
			value: item.name,
		});
		setNameError(null);
	}, []);

	// Submit creation or renaming request to backend
	const handleNameSubmit = useCallback(async () => {
		const dialog = nameDialog;
		if (isViewer || !dialog || !workspacePath) return;

		const name = dialog.value.trim();
		if (!name) {
			setNameError("Name is required.");
			return;
		}
		const problem = validateFileName(name);
		if (problem) {
			setNameError(problem);
			return;
		}

		setIsNameSubmitting(true);
		setNameError(null);

		try {
			const relDir = currentDir;

			if (dialog.mode === "create") {
				const itemRel = joinRelPath(currentDir, name);
				if (dialog.kind === "file") {
					await createWorkspaceFile(workspacePath, relDir, name);
					addActivityEvent(
						"Created file",
						`Created ${name}`,
						`/${itemRel}`,
						"file",
					);
				} else {
					await createWorkspaceFolder(workspacePath, relDir, name);
					addActivityEvent(
						"Created folder",
						`Created folder ${name}`,
						`/${itemRel}`,
						"folder",
					);
				}

				// Open the new file where it belongs
				if (dialog.kind === "file") {
					void handleOpenEntry({ name, path: `/${itemRel}`, is_dir: false, size: 0, modified_at: "" });
				}
			} else if (dialog.mode === "rename" && dialog.item) {
				const relPath = toRelPath(dialog.item.path);
				await renameWorkspaceItem(workspacePath, relPath, name);
				const parent = getParentDir(relPath);
				const newRelPath = parent ? `${parent}/${name}` : name;
				addActivityEvent(
					"Renamed item",
					`Renamed ${dialog.item.name} to ${name}`,
					`/${newRelPath}`,
					dialog.item.is_dir ? "folder" : "file",
				);

				// Carry any live/persisted collaboration state over to the new path instead of
				// stranding it under the old doc id
				if (!dialog.item.is_dir) {
					renameYjsDoc(workspacePath, relPath, newRelPath).catch(() => {});
				}
			}

			setNameDialog(null);
			void loadEntries();
			void refreshStats();
		} catch (err) {
			setNameError(err instanceof Error ? err.message : String(err));
			logError(err, {
				source: "files",
				workspace: workspacePath,
			});
		} finally {
			setIsNameSubmitting(false);
		}
	}, [
		nameDialog,
		workspacePath,
		currentDir,
		isViewer,
		addActivityEvent,
		handleOpenEntry,
		loadEntries,
		refreshStats,
		logError,
	]);

	// Move item to the trash
	const handleDelete = useCallback(async () => {
		if (isViewer || !deleteItem || !workspacePath) return;

		setIsDeleting(true);
		try {
			const relPath = toRelPath(deleteItem.path);
			await deleteWorkspaceItem(workspacePath, relPath);

			addActivityEvent(
				"Deleted item",
				`Deleted ${deleteItem.name}${deleteItem.is_dir ? "/" : ""}`,
				undefined,
				deleteItem.is_dir ? "folder" : "file",
			);

			setDeleteItem(null);
			void loadEntries();
			void refreshStats();
		} catch (err) {
			logError(err, {
				source: "files",
				workspace: workspacePath,
			});
		} finally {
			setIsDeleting(false);
		}
	}, [
		deleteItem,
		workspacePath,
		isViewer,
		addActivityEvent,
		loadEntries,
		refreshStats,
		logError,
	]);

	// Construct breadcrumbs
	const breadcrumbs = getBreadcrumbs(currentDir);
	const crumbs = [
		{ label: workspace?.name || "Workspace", dir: "" },
		...breadcrumbs.map((part, i) => ({
			label: part,
			dir: breadcrumbs.slice(0, i + 1).join("/"),
		})),
	];

	// Folders first, then the chosen order; a new folder or search starts with nothing selected
	const shown = useMemo(() => {
		const q = filter.trim().toLowerCase();
		const list = q ? entries.filter((e) => e.name.toLowerCase().includes(q)) : entries.slice();
		const dir = sort.desc ? -1 : 1;
		return list.sort((a, b) => {
			if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
			const by =
				sort.key === "modified" ? a.modified_at.localeCompare(b.modified_at)
				: sort.key === "size" ? a.size - b.size
				: sort.key === "kind" ? kindOf(a).localeCompare(kindOf(b))
				: 0;
			return (by || a.name.localeCompare(b.name, undefined, { numeric: true })) * dir;
		});
	}, [entries, filter, sort]);
	useEffect(() => {
		setSelected(null);
		setFilter("");
	}, [currentDir]);

	const chosen = shown.find((e) => e.path === selected) ?? null;
	const parentDir = getParentDir(currentDir);
	const openEntry = (entry: WorkspaceFile) => (entry.is_dir ? navigateToDir(joinRelPath(currentDir, entry.name)) : void handleOpenEntry(entry));
	const sortBy = (key: SortKey) => setSort((cur) => (cur.key === key ? { key, desc: !cur.desc } : { key, desc: key === "modified" }));

	const entryMenu = (e: React.MouseEvent, entry: WorkspaceFile | null): void => {
		const create: MenuEntry[] = isViewer
			? []
			: [
					{ label: "New file", icon: <FilePlus className="size-4" />, onSelect: () => openCreateDialog("file") },
					{ label: "New folder", icon: <FolderPlus className="size-4" />, onSelect: () => openCreateDialog("folder") },
				];
		if (!entry) return menu.open(e, [...create, ...(create.length ? (["separator"] as MenuEntry[]) : []), { label: "Refresh", icon: <RefreshCw className="size-4" />, onSelect: () => void loadEntries() }]);
		setSelected(entry.path);
		menu.open(e, [
			{ label: entry.is_dir ? "Open folder" : "Open", icon: <ExternalLink className="size-4" />, shortcut: "Enter", onSelect: () => openEntry(entry) },
			...(entry.is_dir ? [] : [{ label: "File history", icon: <History className="size-4" />, onSelect: () => setHistoryItem(entry) } as MenuEntry]),
			"separator",
			{ label: "Rename…", icon: <Pencil className="size-4" />, shortcut: "F2", disabled: isViewer, onSelect: () => openRenameDialog(entry) },
			{ label: "Delete…", icon: <Trash2 className="size-4" />, shortcut: "Del", danger: true, disabled: isViewer, onSelect: () => setDeleteItem(entry) },
			"separator",
			...create,
		]);
	};

	// Arrow keys move the selection, Enter opens, F2 renames, Delete deletes, Backspace goes up a folder
	const onListKey = (e: React.KeyboardEvent) => {
		if ((e.target as HTMLElement).closest("input")) return;
		const at = shown.findIndex((x) => x.path === selected);
		const cols = view === "grid" ? Math.max(1, Math.floor((listRef.current?.clientWidth ?? 0) / 168)) : 1;
		const go = (i: number) => {
			e.preventDefault();
			const next = shown[Math.min(Math.max(i, 0), shown.length - 1)];
			if (next) {
				setSelected(next.path);
				listRef.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(next.path)}"]`)?.scrollIntoView({ block: "nearest" });
			}
		};
		if (e.key === "ArrowDown") go(at < 0 ? 0 : at + cols);
		else if (e.key === "ArrowUp") go(at < 0 ? 0 : at - cols);
		else if (e.key === "ArrowRight" && view === "grid") go(at + 1);
		else if (e.key === "ArrowLeft" && view === "grid") go(at - 1);
		else if (e.key === "Home") go(0);
		else if (e.key === "End") go(shown.length - 1);
		else if (e.key === "Enter" && chosen) openEntry(chosen);
		else if (e.key === "F2" && chosen && !isViewer) openRenameDialog(chosen);
		else if ((e.key === "Delete" || (e.key === "Backspace" && e.metaKey)) && chosen && !isViewer) setDeleteItem(chosen);
		else if (e.key === "Backspace" && currentDir) navigateToDir(parentDir);
	};

	const header = (key: SortKey, label: string, className: string) => (
		<button
			type="button"
			onClick={() => sortBy(key)}
			aria-label={`Sort by ${label}`}
			className={cn("flex items-center gap-1 outline-none hover:text-foreground focus-visible:text-foreground", className, sort.key === key && "text-foreground")}
		>
			{label}
			{sort.key === key && <ChevronUp className={cn("size-3 transition-transform", sort.desc && "rotate-180")} />}
		</button>
	);

	const folderCount = entries.filter((e) => e.is_dir).length;

	return (
		<div className="flex h-full min-h-0 flex-col bg-background">
			{/* Toolbar */}
			<div className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b bg-card/40 px-3 py-1.5">
				<Button variant="ghost" size="icon-xs" aria-label="Up one folder" isDisabled={!currentDir} onPress={() => navigateToDir(parentDir)}>
					<ChevronUp className="size-4 -rotate-90" />
				</Button>
				<nav className="flex min-w-0 flex-wrap items-center gap-0.5 text-sm" aria-label="Breadcrumb">
					{crumbs.map((crumb, i) => (
						<div key={crumb.dir} className="flex items-center gap-0.5">
							{i > 0 && <ChevronRight className="size-3.5 text-muted-foreground" />}
							<button
								type="button"
								aria-current={i === crumbs.length - 1 ? "page" : undefined}
								className={cn(
									"px-1.5 py-0.5 outline-none transition-colors focus-visible:bg-muted",
									i === crumbs.length - 1 ? "font-medium text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
								)}
								onClick={() => navigateToDir(crumb.dir)}
							>
								{crumb.label}
							</button>
						</div>
					))}
				</nav>
				<span className="flex-1" />
				<div className="relative w-56">
					<Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
					<Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter this folder" aria-label="Filter this folder" className="h-8 border bg-background pl-8 text-sm" />
					{filter && (
						<button type="button" aria-label="Clear filter" onClick={() => setFilter("")} className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
							<X className="size-3.5" />
						</button>
					)}
				</div>
				<div className="flex items-stretch border" role="group" aria-label="View">
					{(["list", "grid"] as const).map((mode) => (
						<button
							key={mode}
							type="button"
							aria-pressed={view === mode}
							aria-label={mode === "list" ? "List view" : "Tile view"}
							onClick={() => setView(mode)}
							className={cn("flex size-8 items-center justify-center outline-none focus-visible:bg-muted", view === mode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
						>
							{mode === "list" ? <ListFilter className="size-4" /> : <LayoutGrid className="size-4" />}
						</button>
					))}
				</div>
				<Button variant="ghost" size="icon-xs" onPress={() => void loadEntries()} aria-label="Refresh files" isDisabled={isLoading}>
					<RefreshCw className={cn("size-4", isLoading && "animate-spin")} />
				</Button>
				{!isViewer && (
					<>
						<Button variant="outline" size="sm" onPress={() => openCreateDialog("folder")}>
							<FolderPlus data-icon="inline-start" className="size-4" />
							New folder
						</Button>
						<Button size="sm" onPress={() => openCreateDialog("file")}>
							<FilePlus data-icon="inline-start" className="size-4" />
							New file
						</Button>
					</>
				)}
			</div>

			{/* Listing */}
			<div className="min-h-0 flex-1 overflow-auto" onContextMenu={(e) => e.target === e.currentTarget && entryMenu(e, null)} onClick={(e) => e.target === e.currentTarget && setSelected(null)}>
				{isLoading && entries.length === 0 ? (
					<Loading className="py-16" />
				) : shown.length === 0 ? (
					<div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center" onContextMenu={(e) => entryMenu(e, null)}>
						<p className="text-sm text-muted-foreground">
							{filter ? `Nothing here matches “${filter}”.` : currentDir ? "This folder is empty." : "No files yet."}
						</p>
						{!filter && !isViewer && (
							<div className="flex gap-2">
								<Button size="sm" onPress={() => openCreateDialog("file")}>
									<FilePlus data-icon="inline-start" className="size-4" />
									New file
								</Button>
								<Button size="sm" variant="outline" onPress={() => openCreateDialog("folder")}>
									<FolderPlus data-icon="inline-start" className="size-4" />
									New folder
								</Button>
							</div>
						)}
					</div>
				) : (
					<>
						{view === "list" && (
							<div className="sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)_7rem_6rem_11rem] items-center gap-4 border-b bg-background px-4 py-2 font-mono text-xs text-muted-foreground">
								{header("name", "Name", "")}
								{header("kind", "Kind", "")}
								{header("size", "Size", "justify-end")}
								{header("modified", "Modified", "justify-end")}
							</div>
						)}
						<ul
							ref={listRef}
							role="listbox"
							aria-label="Files and folders"
							aria-activedescendant={selected ? `file-${selected}` : undefined}
							tabIndex={0}
							onKeyDown={onListKey}
							className={cn("outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ring)]", view === "grid" ? "grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-2 p-4" : "")}
						>
							{shown.map((entry) => {
								const active = entry.path === selected;
								return (
									<li
										key={entry.path}
										id={`file-${entry.path}`}
										data-path={entry.path}
										role="option"
										aria-selected={active}
										onClick={() => setSelected(entry.path)}
										onDoubleClick={() => openEntry(entry)}
										onContextMenu={(e) => entryMenu(e, entry)}
										className={cn(
											"group cursor-default select-none",
											view === "grid"
												? cn("flex flex-col items-center gap-2 border p-4 text-center", active ? "border-primary bg-primary/10" : "border-transparent hover:bg-muted/50")
												: cn("grid grid-cols-[minmax(0,1fr)_7rem_6rem_11rem] items-center gap-4 border-b px-4 py-2", active ? "bg-primary/10 shadow-[inset_2px_0_0_var(--primary)]" : "hover:bg-muted/50"),
										)}
									>
										<span className={cn("flex min-w-0 items-center gap-2.5", view === "grid" && "flex-col")}>
											{entry.is_dir ? <FolderKindIcon name={entry.name} className={view === "grid" ? "size-10" : "size-5"} /> : <FileKindIcon name={entry.name} className={view === "grid" ? "size-10" : "size-5"} />}
											<span className={cn("truncate text-sm", view === "grid" ? "w-full" : "font-medium")}>{entry.name}</span>
										</span>
										{view === "list" && (
											<>
												<span className="truncate text-xs text-muted-foreground">{kindOf(entry)}</span>
												<span className="text-right font-mono text-xs tabular-nums text-muted-foreground">{entry.is_dir ? "—" : formatSize(entry.size)}</span>
												<span className="text-right font-mono text-xs tabular-nums whitespace-nowrap text-muted-foreground">{formatDate(entry.modified_at)}</span>
											</>
										)}
									</li>
								);
							})}
						</ul>
					</>
				)}
			</div>

			{/* Status line */}
			<div className="flex h-8 shrink-0 items-center gap-4 border-t bg-card/40 px-4 font-mono text-xs text-muted-foreground" role="status">
				<span>
					{shown.length} {shown.length === 1 ? "item" : "items"}
					{!filter && folderCount > 0 && ` · ${folderCount} ${folderCount === 1 ? "folder" : "folders"}`}
				</span>
				{chosen && (
					<span className="min-w-0 truncate">
						{chosen.name}
						{!chosen.is_dir && ` · ${formatSize(chosen.size)}`}
					</span>
				)}
				<span className="ml-auto hidden sm:inline">Enter open · F2 rename · Del delete · Backspace up</span>
			</div>

			{menu.menu}

			{/* Create / Rename Dialog */}
			<Dialog
				isOpen={nameDialog !== null}
				onOpenChange={(isOpen) => {
					if (!isOpen && !isNameSubmitting) setNameDialog(null);
				}}
			>
				{nameDialog && (
					<>
						<DialogHeading icon={nameDialog.mode === "create" ? <Plus className="size-6" /> : <Pencil className="size-6" />} title={nameDialog.mode === "create" ?
									`New ${nameDialog.kind === "file" ? "file" : "folder"}`
								:	`Rename ${nameDialog.item?.is_dir ? "folder" : "file"}`} description={<>{nameDialog.mode === "create" ?
									`Create a new ${
										nameDialog.kind === "file" ?
											"file"
										:	"folder"
									} in ${
										currentDir ?
											`/${currentDir}/`
										:	"/"
									}.`
								:	`Enter a new name for ${nameDialog.item?.name}.`
								}</>} />

						<form
							onSubmit={(e) => {
								e.preventDefault();
								void handleNameSubmit();
							}}
						>
							<div className="space-y-2">
								<Label htmlFor="item-name">Name</Label>
								<Input
									id="item-name"
									value={nameDialog.value}
									onChange={(e) =>
										setNameDialog((prev) =>
											prev ?
												{
													...prev,
													value: e.target.value,
												}
											:	prev,
										)
									}
									placeholder={
										nameDialog.kind === "file" ?
											"e.g. notes.md"
										:	"e.g. docs"
									}
									aria-invalid={!!validateFileName(nameDialog.value)}
									autoFocus
								/>
								{(validateFileName(nameDialog.value) ?? nameError) && (
									<p role="alert" className="text-xs text-destructive">
										{validateFileName(nameDialog.value) ?? nameError}
									</p>
								)}
							</div>

							<DialogFooter className="mt-6">
								<DialogClose variant="outline">
									Cancel
								</DialogClose>
								<Button
									type="submit"
									isDisabled={isNameSubmitting || !nameDialog.value.trim() || !!validateFileName(nameDialog.value)}
								>
									{isNameSubmitting ?
										<Loader2 className="size-4 animate-spin" />
									: nameDialog.mode === "create" ?
										<FilePlus
											data-icon="inline-start"
											className="size-4"
										/>
									:	<Pencil
											data-icon="inline-start"
											className="size-4"
										/>
									}
									{nameDialog.mode === "create" ?
										"Create"
									:	"Rename"}
								</Button>
							</DialogFooter>
						</form>
					</>
				)}
			</Dialog>

			{/* Delete Confirmation Dialog */}
			<Dialog
				isOpen={deleteItem !== null}
				onOpenChange={(isOpen) => {
					if (!isOpen && !isDeleting) setDeleteItem(null);
				}}
			>
				{deleteItem && (
					<>
						<DialogHeading icon={<Trash2 className="size-6" />} tone="danger" title={`Delete ${deleteItem.is_dir ? "folder" : "file"}`} description={<>Move{" "}
								<span className="font-semibold text-foreground">
									{deleteItem.name}
									{deleteItem.is_dir && "/"}
								</span>
								{" "}to the Trash?
								{deleteItem.is_dir && " Everything inside it moves too."} You can
								restore it from there.</>} />

						<DialogFooter>
							<DialogClose variant="outline">Cancel</DialogClose>
							<Button
								variant="destructive"
								onPress={() => void handleDelete()}
								isDisabled={isDeleting}
							>
								{isDeleting ?
									<Loader2 className="size-4 animate-spin" />
								:	<Trash2
										data-icon="inline-start"
										className="size-4"
									/>
								}
								Delete
							</Button>
						</DialogFooter>
					</>
				)}
			</Dialog>

			{historyItem && workspace && (
				<FileHistoryDialog
					workspacePath={workspace.path}
					path={toRelPath(historyItem.path)}
					readOnly={isViewer}
					onRestored={() => void loadEntries()}
					onClose={() => setHistoryItem(null)}
				/>
			)}
		</div>
	);
}
