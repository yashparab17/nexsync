// React
import { useCallback, useEffect, useState } from "react";

// Icons
import {
	ChevronRight,
	File,
	FilePlus,
	FolderInput,
	FolderOpen,
	Loader2,
	Pencil,
	RefreshCw,
	Trash2,
} from "lucide-react";

// Components
import EditorContainer from "@/components/elements/editor/EditorContainer";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Context
import { useWorkspace } from "@/store/workspace/WorkspaceContext";

// Hooks
import { useErrorLog } from "@/hooks/useErrorLog";

// Tauri IPC
import {
	createWorkspaceFile,
	createWorkspaceFolder,
	deleteWorkspaceItem,
	listWorkspaceFiles,
	readWorkspaceFile,
	renameWorkspaceItem,
	writeWorkspaceFile,
} from "@/lib/tauri";

// Types
import type { WorkspaceFile } from "@/types/workspace";

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
	return date.toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		year: "numeric",
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
	const logError = useErrorLog();

	const workspacePath = workspace?.path ?? "";

	// Navigation state
	const [currentDir, setCurrentDir] = useState("");
	const [entries, setEntries] = useState<WorkspaceFile[]>([]);
	const [isLoading, setIsLoading] = useState(true);

	// File editor state
	const [openFilePath, setOpenFilePath] = useState<string | null>(null);
	const [openFileContent, setOpenFileContent] = useState("");
	const [isFileLoading, setIsFileLoading] = useState(false);

	// Modal dialog state
	const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null);
	const [nameError, setNameError] = useState<string | null>(null);
	const [isNameSubmitting, setIsNameSubmitting] = useState(false);
	const [deleteItem, setDeleteItem] = useState<WorkspaceFile | null>(null);
	const [isDeleting, setIsDeleting] = useState(false);

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

	// Navigate into a sub-directory
	const navigateToDir = useCallback((dir: string) => {
		setCurrentDir(dir);
	}, []);

	// Read file contents from backend and open editor modal
	const handleOpenEntry = useCallback(
		async (entry: WorkspaceFile) => {
			if (!workspacePath || entry.is_dir) return;

			const relPath = toRelPath(entry.path);

			setIsFileLoading(true);
			try {
				const content = await readWorkspaceFile(workspacePath, relPath);
				setOpenFilePath(relPath);
				setOpenFileContent(content);
			} catch (err) {
				logError(err, {
					source: "files",
					workspace: workspacePath,
				});
			} finally {
				setIsFileLoading(false);
			}
		},
		[workspacePath, logError],
	);

	// Close open file editor
	const handleCloseFile = useCallback(() => {
		setOpenFilePath(null);
		setOpenFileContent("");
	}, []);

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
		if (!dialog || !workspacePath) return;

		const name = dialog.value.trim();
		if (!name) {
			setNameError("Name is required.");
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

				// Auto-open created file in editor
				if (dialog.kind === "file") {
					setIsFileLoading(true);
					try {
						const content = await readWorkspaceFile(
							workspacePath,
							itemRel,
						);
						setOpenFilePath(itemRel);
						setOpenFileContent(content);
					} finally {
						setIsFileLoading(false);
					}
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

				if (openFilePath === relPath) {
					setOpenFilePath(newRelPath);
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
		openFilePath,
		addActivityEvent,
		loadEntries,
		refreshStats,
		logError,
	]);

	// Delete item permanently from disk
	const handleDelete = useCallback(async () => {
		if (!deleteItem || !workspacePath) return;

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

			if (openFilePath === relPath) {
				setOpenFilePath(null);
				setOpenFileContent("");
			}

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
		openFilePath,
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

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex flex-wrap items-end justify-between gap-4">
				<div>
					<h1 className="text-2xl font-semibold">Files</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						Manage your workspace files and folders.
					</p>
				</div>

				{/* Toolbar Actions */}
				<div className="flex gap-2">
					<Button
						variant="outline"
						size="icon"
						onPress={() => void loadEntries()}
						aria-label="Refresh files"
						isDisabled={isLoading}
					>
						<RefreshCw
							className={`size-4 ${isLoading ? "animate-spin" : ""}`}
						/>
					</Button>
					<Button
						variant="outline"
						onPress={() => openCreateDialog("file")}
					>
						<FilePlus data-icon="inline-start" className="size-4" />
						New File
					</Button>
					<Button
						variant="outline"
						onPress={() => openCreateDialog("folder")}
					>
						<FolderInput
							data-icon="inline-start"
							className="size-4"
						/>
						New Folder
					</Button>
				</div>
			</div>

			{/* Breadcrumb navigation */}
			<nav
				className="flex flex-wrap items-center gap-1 text-sm"
				aria-label="Breadcrumb"
			>
				{crumbs.map((crumb, i) => (
					<div key={crumb.dir} className="flex items-center gap-1">
						{i > 0 && (
							<ChevronRight className="size-3.5 text-muted-foreground" />
						)}
						<button
							type="button"
							className={`rounded px-1.5 py-0.5 transition-colors ${
								i === crumbs.length - 1 ?
									"font-medium text-foreground"
								:	"text-muted-foreground hover:bg-muted hover:text-foreground"
							}`}
							onClick={() => navigateToDir(crumb.dir)}
						>
							{crumb.label}
						</button>
					</div>
				))}
			</nav>

			{/* File Listing Table */}
			{isLoading ?
				<div className="flex items-center justify-center py-16">
					<Loader2 className="size-6 animate-spin text-muted-foreground" />
				</div>
			: entries.length === 0 ?
				<div className="border border-dashed py-16 text-center text-sm text-muted-foreground">
					{currentDir ?
						"This folder is empty."
					:	"No files yet. Create your first file or folder to get started."
					}
				</div>
			:	<div className="overflow-hidden border">
					{/* Column headers */}
					<div className="grid grid-cols-[1fr_auto_auto] items-center gap-4 border-b bg-muted/40 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
						<span>Name</span>
						<span className="w-24 text-right">Size</span>
						<span className="w-44 text-right">Modified</span>
					</div>

					<ul className="divide-y">
						{entries.map((entry) => (
							<li key={entry.path}>
								<div className="group grid grid-cols-[1fr_auto_auto] items-center gap-4 px-4 py-2.5 transition-colors hover:bg-muted/50">
									{/* Name */}
									<button
										type="button"
										className="flex min-w-0 items-center gap-2 text-left"
										onClick={() => {
											if (entry.is_dir) {
												navigateToDir(
													currentDir ?
														`${currentDir}/${entry.name}`
													:	entry.name,
												);
											} else {
												void handleOpenEntry(entry);
											}
										}}
									>
										{entry.is_dir ?
											<FolderOpen className="size-4 shrink-0 text-primary/70" />
										:	<File className="size-4 shrink-0 text-muted-foreground" />
										}
										<span className="truncate font-medium">
											{entry.name}
											{entry.is_dir && "/"}
										</span>
									</button>

									{/* Size */}
									<span className="w-24 text-right text-xs text-muted-foreground">
										{entry.is_dir && entry.size === 0 ?
											"—"
										:	formatSize(entry.size)}
									</span>

									{/* Modified + actions */}
									<div className="flex w-44 items-center justify-end gap-1">
										<span className="mr-2 text-xs tabular-nums text-muted-foreground">
											{formatDate(entry.modified_at)}
										</span>

										{/* Row actions */}
										<div className="flex opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
											<Button
												variant="ghost"
												size="icon-sm"
												onPress={() =>
													openRenameDialog(entry)
												}
												aria-label={`Rename ${entry.name}`}
											>
												<Pencil className="size-3.5" />
											</Button>
											<Button
												variant="ghost"
												size="icon-sm"
												onPress={() =>
													setDeleteItem(entry)
												}
												aria-label={`Delete ${entry.name}`}
											>
												<Trash2 className="size-3.5 text-destructive" />
											</Button>
										</div>
									</div>
								</div>
							</li>
						))}
					</ul>
				</div>
			}

			{/* File Editor Modal */}
			<Dialog
				isOpen={openFilePath !== null}
				onOpenChange={(isOpen) => {
					if (!isOpen) handleCloseFile();
				}}
				showCloseButton={false}
				className="sm:max-w-5xl h-[85vh] p-4 flex flex-col"
			>
				{openFilePath && (
					<>
						{isFileLoading ? (
							<div className="flex flex-1 items-center justify-center">
								<Loader2 className="size-6 animate-spin text-muted-foreground" />
							</div>
						) : (
							<EditorContainer
								fileName={openFilePath.split("/").pop() || "file.txt"}
								initialContent={openFileContent}
								onSave={async (newContent) => {
									if (!workspacePath || !openFilePath) return;
									await writeWorkspaceFile(
										workspacePath,
										openFilePath,
										newContent,
									);
									setOpenFileContent(newContent);
									addActivityEvent(
										"Saved file",
										`Edited ${openFilePath}`,
										`/${openFilePath}`,
										"file",
									);
									void loadEntries();
								}}
								onClose={handleCloseFile}
							/>
						)}
					</>
				)}
			</Dialog>

			{/* Create / Rename Dialog */}
			<Dialog
				isOpen={nameDialog !== null}
				onOpenChange={(isOpen) => {
					if (!isOpen && !isNameSubmitting) setNameDialog(null);
				}}
			>
				{nameDialog && (
					<>
						<DialogHeader>
							<DialogTitle>
								{nameDialog.mode === "create" ?
									`New ${nameDialog.kind === "file" ? "File" : "Folder"}`
								:	`Rename ${nameDialog.item?.is_dir ? "Folder" : "File"}`
								}
							</DialogTitle>
							<DialogDescription>
								{nameDialog.mode === "create" ?
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
								}
							</DialogDescription>
						</DialogHeader>

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
									autoFocus
								/>
								{nameError && (
									<p className="text-xs text-destructive">
										{nameError}
									</p>
								)}
							</div>

							<DialogFooter className="mt-6">
								<DialogClose variant="outline">
									Cancel
								</DialogClose>
								<Button
									type="submit"
									isDisabled={isNameSubmitting}
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
						<DialogHeader>
							<DialogTitle>
								Delete {deleteItem.is_dir ? "Folder" : "File"}
							</DialogTitle>
							<DialogDescription>
								Are you sure you want to permanently delete{" "}
								<span className="font-semibold text-foreground">
									{deleteItem.name}
									{deleteItem.is_dir && "/"}
								</span>
								?
								{deleteItem.is_dir &&
									" All nested files and folders will be removed too."}
								This action cannot be undone.
							</DialogDescription>
						</DialogHeader>

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
		</div>
	);
}
