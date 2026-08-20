export default function WorkspaceAssets() {
	return (
		<div>
			<h1 className="text-2xl font-semibold">Assets</h1>
			<p className="mt-1 text-sm text-muted-foreground">
				Assets will appear here.
			</p>
		</div>
	);
}

// // React
// import { useCallback, useEffect, useState } from "react";

// // Icons
// import {
// 	ChevronRight,
// 	File,
// 	FilePlus,
// 	FolderInput,
// 	FolderOpen,
// 	Loader2,
// 	Pencil,
// 	RefreshCw,
// 	Save,
// 	Trash2,
// 	X,
// 	Images,
// 	Video,
// 	Download,
// 	Upload,
// 	Search,
// 	Grid,
// 	List,
// 	Filter,
// } from "lucide-react";

// // Components
// import { Button } from "@/components/ui/button";
// import {
// 	Dialog,
// 	DialogClose,
// 	DialogDescription,
// 	DialogFooter,
// 	DialogHeader,
// 	DialogTitle,
// } from "@/components/ui/dialog";
// import { Input } from "@/components/ui/input";
// import { Label } from "@/components/ui/label";
// import { Textarea } from "@/components/ui/textarea";
// import { Badge } from "@/components/ui/badge";

// // Context
// import { useWorkspace } from "@/store/workspace/WorkspaceContext";

// // Hooks
// import { useErrorLog } from "@/hooks/useErrorLog";

// // Tauri
// import {
// 	createWorkspaceFile,
// 	createWorkspaceFolder,
// 	deleteWorkspaceItem,
// 	listWorkspaceFiles,
// 	readWorkspaceFile,
// 	renameWorkspaceItem,
// 	writeWorkspaceFile,
// } from "@/lib/tauri";

// // Types
// import type { WorkspaceFile } from "@/types/workspace";

// // ─── helpers ─────────────────────────────────────────────

// /** Formats a byte count into a compact human-readable string. */
// function formatSize(bytes: number): string {
// 	if (bytes === 0) return "Empty";
// 	if (bytes < 1024) return `${bytes} B`;
// 	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
// 	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
// }

// /** Formats an ISO-8601 timestamp as a locale date + time. */
// function formatDate(iso: string): string {
// 	if (!iso) return "—";
// 	const date = new Date(iso);
// 	if (Number.isNaN(date.getTime())) return "—";
// 	return date.toLocaleString(undefined, {
// 		month: "short",
// 		day: "numeric",
// 		year: "numeric",
// 		hour: "numeric",
// 		minute: "2-digit",
// 	});
// }

// /** Strips the leading `/` and returns a relative path (e.g. `/files/a.md` → `files/a.md`). */
// function toRelPath(entryPath: string): string {
// 	return entryPath.replace(/^\/+/, "");
// }

// /** Joins the current directory with a name to form a backend-safe relative path. */
// function joinRelPath(currentDir: string, name: string): string {
// 	return currentDir ? `${currentDir}/${name}` : name;
// }

// /** Splits a directory path into breadcrumb segments (excluding the root `files`). */
// function getBreadcrumbs(currentDir: string): string[] {
// 	return currentDir ? currentDir.split("/") : [];
// }

// /** Returns the parent directory path for a given relative path. */
// function getParentDir(relPath: string): string {
// 	const parts = relPath.split("/");
// 	parts.pop();
// 	return parts.join("/");
// }

// /** Gets file extension from path */
// function getFileExtension(path: string): string {
// 	return path.split(".").pop()?.toLowerCase() || "";
// }

// /** Determines if a file is an image */
// function isImageFile(path: string): boolean {
// 	const ext = getFileExtension(path);
// 	return ["jpg", "jpeg", "png", "gif", "webp", "bmp"].includes(ext);
// }

// /** Determines if a file is a video */
// function isVideoFile(path: string): boolean {
// 	const ext = getFileExtension(path);
// 	return ["mp4", "webm", "ogg", "mov", "avi"].includes(ext);
// }

// /** Determines if a file is audio */
// function isAudioFile(path: string): boolean {
// 	const ext = getFileExtension(path);
// 	return ["mp3", "wav", "ogg", "flac", "aac"].includes(ext);
// }

// // ─── name dialog (shared by create + rename) ─────────────

// interface NameDialogState {
// 	mode: "create" | "rename";
// 	kind: "file" | "folder";
// 	/** The item being renamed (only for rename mode). */
// 	item?: WorkspaceFile;
// 	value: string;
// }

// export default function WorkspaceAssets() {
// 	// ── State variables ──
// 	const { workspace, refreshStats, addActivityEvent } = useWorkspace();
// 	const logError = useErrorLog();

// 	const workspacePath = workspace?.path ?? "";

// 	// ── Navigation state ──
// 	const [currentDir, setCurrentDir] = useState("");
// 	const [entries, setEntries] = useState<WorkspaceFile[]>([]);
// 	const [isLoading, setIsLoading] = useState(true);

// 	// ── File viewer/editor state ──
// 	const [openFilePath, setOpenFilePath] = useState<string | null>(null);
// 	const [openFileContent, setOpenFileContent] = useState("");
// 	const [isFileLoading, setIsFileLoading] = useState(false);
// 	const [isSaving, setIsSaving] = useState(false);
// 	const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

// 	// ── Dialog state ──
// 	const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null);
// 	const [nameError, setNameError] = useState<string | null>(null);
// 	const [isNameSubmitting, setIsNameSubmitting] = useState(false);
// 	const [deleteItem, setDeleteItem] = useState<WorkspaceFile | null>(null);
// 	const [isDeleting, setIsDeleting] = useState(false);

// 	// ── Asset specific state ──
// 	const [searchQuery, setSearchQuery] = useState("");
// 	const [showFilters, setShowFilters] = useState(false);
// 	const [filterType, setFilterType] = useState<
// 		"all" | "images" | "videos" | "audio" | "documents"
// 	>("all");
// 	const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
// 	const [uploadDialogOpen, setUploadDialogOpen] = useState(false);

// 	// ── File listing ──

// 	const loadEntries = useCallback(async () => {
// 		if (!workspacePath) return;
// 		setIsLoading(true);
// 		try {
// 			// `assets` is the root of this feature's content folder.
// 			const relDir = currentDir ? `assets/${currentDir}` : "assets";
// 			const next = await listWorkspaceFiles(workspacePath, relDir);
// 			setEntries(next);
// 		} catch (err) {
// 			logError(err, {
// 				source: "assets",
// 				workspace: workspacePath,
// 			});
// 			setEntries([]);
// 		} finally {
// 			setIsLoading(false);
// 		}
// 	}, [workspacePath, currentDir, logError]);

// 	useEffect(() => {
// 		void loadEntries();
// 	}, [loadEntries]);

// 	const navigateToDir = useCallback((dir: string) => {
// 		setCurrentDir(dir);
// 	}, []);

// 	// ── File open / save ──

// 	const handleOpenEntry = useCallback(
// 		async (entry: WorkspaceFile) => {
// 			if (!workspacePath || entry.is_dir) return;

// 			const relPath = toRelPath(entry.path);

// 			// Discard unsaved changes silently? The dialog is the guard;
// 			// opening a new file simply replaces the current one.
// 			setIsFileLoading(true);
// 			try {
// 				const content = await readWorkspaceFile(workspacePath, relPath);
// 				setOpenFilePath(relPath);
// 				setOpenFileContent(content);
// 				setHasUnsavedChanges(false);
// 			} catch (err) {
// 				logError(err, {
// 					source: "assets",
// 					workspace: workspacePath,
// 				});
// 			} finally {
// 				setIsFileLoading(false);
// 			}
// 		},
// 		[workspacePath, logError],
// 	);

// 	const handleSaveFile = useCallback(async () => {
// 		if (!workspacePath || !openFilePath) return;

// 		setIsSaving(true);
// 		try {
// 			await writeWorkspaceFile(
// 				workspacePath,
// 				openFilePath,
// 				openFileContent,
// 			);
// 			setHasUnsavedChanges(false);
// 			addActivityEvent(
// 				"Saved file",
// 				`Edited ${openFilePath}`,
// 				`/${openFilePath}`,
// 				"file",
// 			);
// 			// Refresh listing to pick up the new modified time.
// 			void loadEntries();
// 		} catch (err) {
// 			logError(err, {
// 				source: "assets",
// 				workspace: workspacePath,
// 			});
// 		} finally {
// 			setIsSaving(false);
// 		}
// 	}, [
// 		workspacePath,
// 		openFilePath,
// 		openFileContent,
// 		addActivityEvent,
// 		loadEntries,
// 		logError,
// 	]);

// 	const handleCloseFile = useCallback(() => {
// 		if (hasUnsavedChanges) {
// 			// Confirmation happens in the dialog footer button.
// 			setOpenFilePath(null);
// 			setOpenFileContent("");
// 			setHasUnsavedChanges(false);
// 			return;
// 		}
// 		setOpenFilePath(null);
// 		setOpenFileContent("");
// 	}, [hasUnsavedChanges]);

// 	// ── Create / rename ──

// 	const openCreateDialog = useCallback((kind: "file" | "folder") => {
// 		setNameDialog({ mode: "create", kind, value: "" });
// 		setNameError(null);
// 	}, []);

// 	const openRenameDialog = useCallback((item: WorkspaceFile) => {
// 		setNameDialog({
// 			mode: "rename",
// 			kind: item.is_dir ? "folder" : "file",
// 			item,
// 			value: item.name,
// 		});
// 		setNameError(null);
// 	}, []);

// 	const handleNameSubmit = useCallback(async () => {
// 		const dialog = nameDialog;
// 		if (!dialog || !workspacePath) return;

// 		const name = dialog.value.trim();
// 		if (!name) {
// 			setNameError("Name is required.");
// 			return;
// 		}

// 		setIsNameSubmitting(true);
// 		setNameError(null);

// 		try {
// 			const relDir = currentDir ? `assets/${currentDir}` : "assets";

// 			if (dialog.mode === "create") {
// 				if (dialog.kind === "file") {
// 					await createWorkspaceFile(workspacePath, relDir, name);
// 					addActivityEvent(
// 						"Created file",
// 						`Created ${joinRelPath(currentDir, name)}`,
// 						`/assets/${joinRelPath(currentDir, name)}`,
// 						"file",
// 					);
// 				} else {
// 					await createWorkspaceFolder(workspacePath, relDir, name);
// 					addActivityEvent(
// 						"Created folder",
// 						`Created ${joinRelPath(currentDir, name)}`,
// 						`/assets/${joinRelPath(currentDir, name)}`,
// 						"folder",
// 					);
// 				}

// 				// Auto-open newly created files so the user can start typing.
// 				if (dialog.kind === "file") {
// 					const newPath = `assets/${joinRelPath(currentDir, name)}`;
// 					setIsFileLoading(true);
// 					try {
// 						const content = await readWorkspaceFile(
// 							workspacePath,
// 							newPath,
// 						);
// 						setOpenFilePath(newPath);
// 						setOpenFileContent(content);
// 						setHasUnsavedChanges(false);
// 					} finally {
// 						setIsFileLoading(false);
// 					}
// 				}
// 			} else if (dialog.mode === "rename" && dialog.item) {
// 				const relPath = toRelPath(dialog.item.path);
// 				await renameWorkspaceItem(workspacePath, relPath, name);
// 				addActivityEvent(
// 					"Renamed",
// 					`Renamed ${dialog.item.name} to ${name}`,
// 					`/${getParentDir(relPath)}/${name}`,
// 					dialog.item.is_dir ? "folder" : "file",
// 				);

// 				// If the open file was renamed, update the editor path.
// 				if (openFilePath === relPath) {
// 					const newRelPath = `${getParentDir(relPath)}/${name}`;
// 					setOpenFilePath(newRelPath);
// 				}
// 			}

// 			setNameDialog(null);
// 			void loadEntries();
// 			void refreshStats();
// 		} catch (err) {
// 			setNameError(err instanceof Error ? err.message : String(err));
// 			logError(err, {
// 				source: "assets",
// 				workspace: workspacePath,
// 			});
// 		} finally {
// 			setIsNameSubmitting(false);
// 		}
// 	}, [
// 		nameDialog,
// 		workspacePath,
// 		currentDir,
// 		openFilePath,
// 		addActivityEvent,
// 		loadEntries,
// 		refreshStats,
// 		logError,
// 	]);

// 	// ── Delete ──

// 	const handleDelete = useCallback(async () => {
// 		if (!deleteItem || !workspacePath) return;

// 		setIsDeleting(true);
// 		try {
// 			const relPath = toRelPath(deleteItem.path);
// 			await deleteWorkspaceItem(workspacePath, relPath);

// 			addActivityEvent(
// 				"Deleted",
// 				`Deleted ${deleteItem.name}${deleteItem.is_dir ? "/" : ""}`,
// 				undefined,
// 				deleteItem.is_dir ? "folder" : "file",
// 			);

// 			// If the deleted item was the open file, close the editor.
// 			if (openFilePath === relPath) {
// 				setOpenFilePath(null);
// 				setOpenFileContent("");
// 				setHasUnsavedChanges(false);
// 			}

// 			setDeleteItem(null);
// 			void loadEntries();
// 			void refreshStats();
// 		} catch (err) {
// 			logError(err, {
// 				source: "assets",
// 				workspace: workspacePath,
// 			});
// 		} finally {
// 			setIsDeleting(false);
// 		}
// 	}, [
// 		deleteItem,
// 		workspacePath,
// 		openFilePath,
// 		addActivityEvent,
// 		loadEntries,
// 		refreshStats,
// 		logError,
// 	]);

// 	// ── Upload ──

// 	const openUploadDialog = useCallback(() => {
// 		setUploadDialogOpen(true);
// 	}, []);

// 	// ── Breadcrumb rendering ──

// 	const breadcrumbs = getBreadcrumbs(currentDir);
// 	const crumbs = [
// 		{ label: "Assets", dir: "" },
// 		...breadcrumbs.map((part, i) => ({
// 			label: part,
// 			dir: breadcrumbs.slice(0, i + 1).join("/"),
// 		})),
// 	];

// 	// ── Filtered entries ──

// 	const filteredEntries = entries
// 		.filter((entry) => {
// 			if (filterType === "all") return true;

// 			if (filterType === "images" && !isImageFile(entry.path))
// 				return false;
// 			if (filterType === "videos" && !isVideoFile(entry.path))
// 				return false;
// 			if (filterType === "audio" && !isAudioFile(entry.path))
// 				return false;
// 			if (filterType === "documents") {
// 				// Documents are files that aren't images, videos, or audio
// 				return (
// 					!isImageFile(entry.path) &&
// 					!isVideoFile(entry.path) &&
// 					!isAudioFile(entry.path)
// 				);
// 			}

// 			return true;
// 		})
// 		.filter((entry) => {
// 			// Apply search filter
// 			if (!searchQuery) return true;
// 			return entry.name.toLowerCase().includes(searchQuery.toLowerCase());
// 		});

// 	// ── Render ──

// 	return (
// 		<div className="space-y-6">
// 			{/* Header */}
// 			<div className="flex flex-wrap items-end justify-between gap-4">
// 				<div>
// 					<h1 className="text-2xl font-semibold">Assets</h1>
// 					<p className="mt-1 text-sm text-muted-foreground">
// 						Media files and attachments.
// 					</p>
// 				</div>

// 				<div className="flex gap-2">
// 					<Button
// 						variant="outline"
// 						size="icon"
// 						onPress={() => void loadEntries()}
// 						aria-label="Refresh assets"
// 						isDisabled={isLoading}
// 					>
// 						<RefreshCw
// 							className={`size-4 ${isLoading ? "animate-spin" : ""}`}
// 						/>
// 					</Button>
// 					<Button
// 						variant="outline"
// 						onPress={() => openCreateDialog("file")}
// 					>
// 						<FilePlus data-icon="inline-start" className="size-4" />
// 						New File
// 					</Button>
// 					<Button
// 						variant="outline"
// 						onPress={() => openCreateDialog("folder")}
// 					>
// 						<FolderInput
// 							data-icon="inline-start"
// 							className="size-4"
// 						/>
// 						New Folder
// 					</Button>
// 					<Button
// 						variant="outline"
// 						onPress={() => openUploadDialog()}
// 					>
// 						<Upload data-icon="inline-start" className="size-4" />
// 						Upload
// 					</Button>
// 				</div>
// 			</div>

// 			{/* Filter bar */}
// 			<div className="flex flex-wrap items-center gap-2">
// 				<div className="relative flex-1 max-w-md">
// 					<Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
// 					<Input
// 						placeholder="Search assets..."
// 						className="pl-8"
// 						value={searchQuery}
// 						onChange={(e) => setSearchQuery(e.target.value)}
// 					/>
// 				</div>
// 				<Button
// 					variant="outline"
// 					size="sm"
// 					onPress={() => setShowFilters(!showFilters)}
// 				>
// 					<Filter className="size-4 mr-1" />
// 					Filters
// 				</Button>
// 				<div className="flex gap-1">
// 					<Button
// 						variant={viewMode === "grid" ? "default" : "outline"}
// 						size="sm"
// 						onPress={() => setViewMode("grid")}
// 					>
// 						<Grid className="size-4" />
// 					</Button>
// 					<Button
// 						variant={viewMode === "list" ? "default" : "outline"}
// 						size="sm"
// 						onPress={() => setViewMode("list")}
// 					>
// 						<List className="size-4" />
// 					</Button>
// 				</div>
// 			</div>

// 			{/* Filters panel */}
// 			{showFilters && (
// 				<div className="border rounded-lg p-4">
// 					<div className="flex flex-wrap gap-2">
// 						<Badge
// 							variant={
// 								filterType === "all" ? "default" : "outline"
// 							}
// 							onPress={() => setFilterType("all")}
// 						>
// 							All
// 						</Badge>
// 						<Badge
// 							variant={
// 								filterType === "images" ? "default" : "outline"
// 							}
// 							onPress={() => setFilterType("images")}
// 						>
// 							Images
// 						</Badge>
// 						<Badge
// 							variant={
// 								filterType === "videos" ? "default" : "outline"
// 							}
// 							onPress={() => setFilterType("videos")}
// 						>
// 							Videos
// 						</Badge>
// 						<Badge
// 							variant={
// 								filterType === "audio" ? "default" : "outline"
// 							}
// 							onPress={() => setFilterType("audio")}
// 						>
// 							Audio
// 						</Badge>
// 						<Badge
// 							variant={
// 								filterType === "documents" ? "default" : (
// 									"outline"
// 								)
// 							}
// 							onPress={() => setFilterType("documents")}
// 						>
// 							Documents
// 						</Badge>
// 					</div>
// 				</div>
// 			)}

// 			{/* Breadcrumb navigation */}
// 			<nav
// 				className="flex flex-wrap items-center gap-1 text-sm"
// 				aria-label="Breadcrumb"
// 			>
// 				{crumbs.map((crumb, i) => (
// 					<div key={crumb.dir} className="flex items-center gap-1">
// 						{i > 0 && (
// 							<ChevronRight className="size-3.5 text-muted-foreground" />
// 						)}
// 						<button
// 							type="button"
// 							className={`rounded px-1.5 py-0.5 transition-colors ${
// 								i === crumbs.length - 1 ?
// 									"font-medium text-foreground"
// 								:	"text-muted-foreground hover:bg-muted hover:text-foreground"
// 							}`}
// 							onClick={() => navigateToDir(crumb.dir)}
// 						>
// 							{crumb.label}
// 						</button>
// 					</div>
// 				))}
// 			</nav>

// 			{/* Content */}
// 			{isLoading ?
// 				<div className="flex items-center justify-center py-16">
// 					<Loader2 className="size-6 animate-spin text-muted-foreground" />
// 				</div>
// 			: entries.length === 0 ?
// 				<div className="border border-dashed py-16 text-center text-sm text-muted-foreground">
// 					{currentDir ?
// 						"This folder is empty."
// 					:	"No assets yet. Upload your first file to get started."}
// 				</div>
// 			: viewMode === "grid" ?
// 				<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
// 					{filteredEntries.map((entry) => (
// 						<div
// 							key={entry.path}
// 							className="border rounded-lg overflow-hidden hover:shadow-md transition-shadow cursor-pointer"
// 							onClick={() => {
// 								if (entry.is_dir) {
// 									navigateToDir(
// 										currentDir ?
// 											`${currentDir}/${entry.name}`
// 										:	entry.name,
// 									);
// 								} else {
// 									void handleOpenEntry(entry);
// 								}
// 							}}
// 						>
// 							<div className="p-2 flex items-center justify-center h-32 bg-muted/50">
// 								{entry.is_dir ?
// 									<FolderOpen className="size-8 text-primary/70" />
// 								: isImageFile(entry.path) ?
// 									<Images className="size-8 text-primary/70" />
// 								: isVideoFile(entry.path) ?
// 									<Video className="size-8 text-primary/70" />
// 								: isAudioFile(entry.path) ?
// 									<Audio className="size-8 text-primary/70" />
// 								:	<File className="size-8 text-muted-foreground" />
// 								}
// 							</div>
// 							<div className="p-2">
// 								<h3 className="font-medium truncate">
// 									{entry.name}
// 								</h3>
// 								<p className="text-xs text-muted-foreground">
// 									{entry.is_dir ?
// 										"folder"
// 									:	formatSize(entry.size)}
// 								</p>
// 							</div>
// 						</div>
// 					))}
// 				</div>
// 			:	<div className="overflow-hidden border">
// 					{/* Column headers */}
// 					<div className="grid grid-cols-[1fr_auto_auto] items-center gap-4 border-b bg-muted/40 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
// 						<span>Name</span>
// 						<span className="w-24 text-right">Size</span>
// 						<span className="w-44 text-right">Modified</span>
// 					</div>

// 					<ul className="divide-y">
// 						{filteredEntries.map((entry) => (
// 							<li key={entry.path}>
// 								<div className="group grid grid-cols-[1fr_auto_auto] items-center gap-4 px-4 py-2.5 transition-colors hover:bg-muted/50">
// 									{/* Name */}
// 									<button
// 										type="button"
// 										className="flex min-w-0 items-center gap-2 text-left"
// 										onClick={() => {
// 											if (entry.is_dir) {
// 												navigateToDir(
// 													currentDir ?
// 														`${currentDir}/${entry.name}`
// 													:	entry.name,
// 												);
// 											} else {
// 												void handleOpenEntry(entry);
// 											}
// 										}}
// 									>
// 										{entry.is_dir ?
// 											<FolderOpen className="size-4 shrink-0 text-primary/70" />
// 										: isImageFile(entry.path) ?
// 											<Images className="size-4 shrink-0 text-primary/70" />
// 										: isVideoFile(entry.path) ?
// 											<Video className="size-4 shrink-0 text-primary/70" />
// 										: isAudioFile(entry.path) ?
// 											<Audio className="size-4 shrink-0 text-primary/70" />
// 										:	<File className="size-4 shrink-0 text-muted-foreground" />
// 										}
// 										<span className="truncate font-medium">
// 											{entry.name}
// 											{entry.is_dir && "/"}
// 										</span>
// 									</button>

// 									{/* Size */}
// 									<span className="w-24 text-right text-xs text-muted-foreground">
// 										{entry.is_dir && entry.size === 0 ?
// 											"—"
// 										:	formatSize(entry.size)}
// 									</span>

// 									{/* Modified + actions */}
// 									<div className="flex w-44 items-center justify-end gap-1">
// 										<span className="mr-2 text-xs tabular-nums text-muted-foreground">
// 											{formatDate(entry.modified_at)}
// 										</span>

// 										{/* Actions (visible on hover/focus) */}
// 										<div className="flex opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
// 											<Button
// 												variant="ghost"
// 												size="icon-sm"
// 												onPress={() =>
// 													openRenameDialog(entry)
// 												}
// 												aria-label={`Rename ${entry.name}`}
// 											>
// 												<Pencil className="size-3.5" />
// 											</Button>
// 											<Button
// 												variant="ghost"
// 												size="icon-sm"
// 												onPress={() =>
// 													setDeleteItem(entry)
// 												}
// 												aria-label={`Delete ${entry.name}`}
// 											>
// 												<Trash2 className="size-3.5 text-destructive" />
// 											</Button>
// 										</div>
// 									</div>
// 								</div>
// 							</li>
// 						))}
// 					</ul>
// 				</div>
// 			}

// 			{/* ── File viewer / editor dialog ── */}
// 			<Dialog
// 				isOpen={openFilePath !== null}
// 				onOpenChange={(isOpen) => {
// 					if (!isOpen) handleCloseFile();
// 				}}
// 				showCloseButton={false}
// 				className="sm:max-w-2xl"
// 			>
// 				{openFilePath && (
// 					<>
// 						<DialogHeader>
// 							<div className="flex items-center justify-between gap-3">
// 								<DialogTitle className="truncate">
// 									{openFilePath.split("/").pop()}
// 								</DialogTitle>
// 								<DialogClose
// 									variant="ghost"
// 									size="icon-sm"
// 									className="bg-secondary"
// 									onPress={handleCloseFile}
// 								>
// 									<X className="size-4" />
// 									<span className="sr-only">Close</span>
// 								</DialogClose>
// 							</div>
// 							<DialogDescription className="truncate">
// 								/{openFilePath}
// 							</DialogDescription>
// 						</DialogHeader>

// 						{isFileLoading ?
// 							<div className="flex items-center justify-center py-16">
// 								<Loader2 className="size-6 animate-spin text-muted-foreground" />
// 							</div>
// 						: isImageFile(openFilePath) ?
// 							<div className="p-4 flex items-center justify-center">
// 								<img
// 									src={`file://${workspacePath}/${openFilePath}`}
// 									alt={openFilePath}
// 									className="max-h-96 max-w-full object-contain"
// 								/>
// 							</div>
// 						: isVideoFile(openFilePath) ?
// 							<div className="p-4 flex items-center justify-center">
// 								<video
// 									src={`file://${workspacePath}/${openFilePath}`}
// 									controls
// 									className="max-h-96 max-w-full"
// 								/>
// 							</div>
// 						:	<Textarea
// 								value={openFileContent}
// 								onChange={(e) => {
// 									setOpenFileContent(e.target.value);
// 									setHasUnsavedChanges(true);
// 								}}
// 								placeholder="File is empty — start typing…"
// 								aria-label="File contents"
// 								className="min-h-64 font-mono text-xs leading-relaxed"
// 							/>
// 						}

// 						<DialogFooter>
// 							{hasUnsavedChanges && (
// 								<p className="flex items-center gap-1.5 text-xs text-muted-foreground">
// 									<span className="size-1.5 rounded-full bg-amber-500" />
// 									Unsaved changes
// 								</p>
// 							)}
// 							<DialogClose
// 								variant="outline"
// 								onPress={handleCloseFile}
// 							>
// 								Close
// 							</DialogClose>
// 							<Button
// 								onPress={() => void handleSaveFile()}
// 								isDisabled={isSaving}
// 							>
// 								{isSaving ?
// 									<Loader2 className="size-4 animate-spin" />
// 								:	<Save
// 										data-icon="inline-start"
// 										className="size-4"
// 									/>
// 								}
// 								Save
// 							</Button>
// 						</DialogFooter>
// 					</>
// 				)}
// 			</Dialog>

// 			{/* ── Create / rename dialog ── */}
// 			<Dialog
// 				isOpen={nameDialog !== null}
// 				onOpenChange={(isOpen) => {
// 					if (!isOpen && !isNameSubmitting) setNameDialog(null);
// 				}}
// 			>
// 				{nameDialog && (
// 					<>
// 						<DialogHeader>
// 							<DialogTitle>
// 								{nameDialog.mode === "create" ?
// 									`New ${nameDialog.kind === "file" ? "File" : "Folder"}`
// 								:	`Rename ${nameDialog.item?.is_dir ? "Folder" : "File"}`
// 								}
// 							</DialogTitle>
// 							<DialogDescription>
// 								{nameDialog.mode === "create" ?
// 									`Create a new ${
// 										nameDialog.kind === "file" ?
// 											"file"
// 										:	"folder"
// 									} in ${
// 										currentDir ?
// 											`/assets/${currentDir}/`
// 										:	"/assets/"
// 									}.`
// 								:	`Enter a new name for ${nameDialog.item?.name}.`
// 								}
// 							</DialogDescription>
// 						</DialogHeader>

// 						<form
// 							onSubmit={(e) => {
// 								e.preventDefault();
// 								void handleNameSubmit();
// 							}}
// 						>
// 							<div className="space-y-2">
// 								<Label htmlFor="item-name">Name</Label>
// 								<Input
// 									id="item-name"
// 									value={nameDialog.value}
// 									onChange={(e) =>
// 										setNameDialog((prev) =>
// 											prev ?
// 												{
// 													...prev,
// 													value: e.target.value,
// 												}
// 											:	prev,
// 										)
// 									}
// 									placeholder={
// 										nameDialog.kind === "file" ?
// 											"e.g. photo.jpg"
// 										:	"e.g. docs"
// 									}
// 									autoFocus
// 								/>
// 								{nameError && (
// 									<p className="text-xs text-destructive">
// 										{nameError}
// 									</p>
// 								)}
// 							</div>

// 							<DialogFooter className="mt-6">
// 								<DialogClose variant="outline">
// 									Cancel
// 								</DialogClose>
// 								<Button
// 									type="submit"
// 									isDisabled={isNameSubmitting}
// 								>
// 									{isNameSubmitting ?
// 										<Loader2 className="size-4 animate-spin" />
// 									: nameDialog.mode === "create" ?
// 										<FilePlus
// 											data-icon="inline-start"
// 											className="size-4"
// 										/>
// 									:	<Pencil
// 											data-icon="inline-start"
// 											className="size-4"
// 										/>
// 									}
// 									{nameDialog.mode === "create" ?
// 										"Create"
// 									:	"Rename"}
// 								</Button>
// 							</DialogFooter>
// 						</form>
// 					</>
// 				)}
// 			</Dialog>

// 			{/* ── Delete confirmation dialog ── */}
// 			<Dialog
// 				isOpen={deleteItem !== null}
// 				onOpenChange={(isOpen) => {
// 					if (!isOpen && !isDeleting) setDeleteItem(null);
// 				}}
// 			>
// 				{deleteItem && (
// 					<>
// 						<DialogHeader>
// 							<DialogTitle>
// 								Delete {deleteItem.is_dir ? "Folder" : "File"}
// 							</DialogTitle>
// 							<DialogDescription>
// 								Are you sure you want to permanently delete{" "}
// 								<span className="font-semibold text-foreground">
// 									{deleteItem.name}
// 								</span>
// 								?
// 								{deleteItem.is_dir &&
// 									" All nested files and folders will be removed too."}
// 								This action cannot be undone.
// 							</DialogDescription>
// 						</DialogHeader>

// 						<DialogFooter>
// 							<DialogClose variant="outline">Cancel</DialogClose>
// 							<Button
// 								variant="destructive"
// 								onPress={() => void handleDelete()}
// 								isDisabled={isDeleting}
// 							>
// 								{isDeleting ?
// 									<Loader2 className="size-4 animate-spin" />
// 								:	<Trash2
// 										data-icon="inline-start"
// 										className="size-4"
// 									/>
// 								}
// 								Delete
// 							</Button>
// 						</DialogFooter>
// 					</>
// 				)}
// 			</Dialog>

// 			{/* ── Upload dialog ── */}
// 			<Dialog
// 				isOpen={uploadDialogOpen}
// 				onOpenChange={(isOpen) => {
// 					if (!isOpen) setUploadDialogOpen(false);
// 				}}
// 			>
// 				<>
// 					<DialogHeader>
// 						<DialogTitle>Upload Assets</DialogTitle>
// 						<DialogDescription>
// 							Select files to upload to your workspace assets.
// 						</DialogDescription>
// 					</DialogHeader>

// 					<div className="p-4 border rounded-lg">
// 						<div className="flex flex-col items-center justify-center py-8 border-2 border-dashed rounded-lg">
// 							<Upload className="size-12 text-muted-foreground mb-4" />
// 							<p className="mb-2">Drag & drop files here</p>
// 							<p className="text-sm text-muted-foreground mb-4">
// 								or click to browse
// 							</p>
// 							<Button variant="outline">Browse Files</Button>
// 						</div>
// 						<div className="mt-4 text-sm text-muted-foreground">
// 							<p>
// 								Supported formats: JPG, PNG, GIF, MP4, MP3, PDF,
// 								etc.
// 							</p>
// 						</div>
// 					</div>

// 					<DialogFooter>
// 						<DialogClose variant="outline">Cancel</DialogClose>
// 						<Button>Upload</Button>
// 					</DialogFooter>
// 				</>
// 			</Dialog>
// 		</div>
// 	);
// }
