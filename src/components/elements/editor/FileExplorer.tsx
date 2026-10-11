import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ChevronRight, Columns3, Copy, RefreshCw, Search, Trash2, ChevronDown, ChevronsDownUp, Download, FilePlus, Folder, FolderOpen, FolderPlus, Pencil, X } from "@/components/animate-icons";

import FileKindIcon from "./FileKindIcon";
import { useContextMenu, type MenuEntry } from "@/components/elements/ContextMenu";
import { Button } from "@/components/ui/button";
import PresenceDots from "@/components/elements/PresenceDots";
import { cn } from "@/lib/utils";
import type { WorkspaceFile } from "@/types/workspace";

// Entry paths from the backend start with a slash; the rest of the Editor tab uses them without it
const toRel = (path: string) => path.replace(/^\/+/, "");

interface FileExplorerProps {
	// Top-level folders shown, such as editor and files
	roots: string[];
	// Folder path to its listing; a folder that is not loaded yet has no entry
	entries: Record<string, WorkspaceFile[]>;
	expanded: Set<string>;
	// The folder new files and folders are created in
	targetDir: string;
	activePath: string | null;
	openPaths: string[];
	dirtyPaths: Set<string>;
	readOnly: boolean;
	// Who has a file open right now, by name
	viewers?: (rel: string) => string[];
	onToggleDir: (dir: string) => void;
	onOpenFile: (rel: string) => void;
	onNew: (kind: "file" | "folder", dir: string) => void;
	onRename: (entry: WorkspaceFile) => void;
	onDelete: (entry: WorkspaceFile) => void;
	onRefresh: () => void;
	onCollapseAll: () => void;
	// Called when a filter is first typed, so the whole tree can be loaded and searched
	onFilterStart: () => void;
	// Zips the folder that new files go in; the result or its error shows under the filter
	onExport: () => void;
	notice: { ok: boolean; text: string } | null;
	// Open a file in the pane beside the current one, and copy a path; the right-click menu offers both
	onOpenSide?: (rel: string) => void;
	onCopyPath?: (rel: string) => void;
}

// The Editor tab's file browser: a tree with folder actions, rename, delete, a filter and keyboard control
export default function FileExplorer({
	roots,
	entries,
	expanded,
	targetDir,
	activePath,
	openPaths,
	dirtyPaths,
	readOnly,
	viewers,
	onToggleDir,
	onOpenFile,
	onNew,
	onRename,
	onDelete,
	onRefresh,
	onCollapseAll,
	onFilterStart,
	onExport,
	notice,
	onOpenSide,
	onCopyPath,
}: FileExplorerProps) {
	const { open: openMenu, menu } = useContextMenu();
	const [query, setQuery] = useState("");
	const treeRef = useRef<HTMLDivElement>(null);
	const needle = query.trim().toLowerCase();
	const filtering = needle !== "";

	useEffect(() => {
		if (filtering) onFilterStart();
		// Only the moment a filter starts matters
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [filtering]);

	const matches = (name: string) => name.toLowerCase().includes(needle);

	// A folder stays in the filtered tree when it or something inside it matches
	const hasMatch = (dir: string): boolean =>
		(entries[dir] ?? []).some((e) => matches(e.name) || (e.is_dir && hasMatch(toRel(e.path))));

	const moveFocus = (from: HTMLElement, step: 1 | -1) => {
		const rows = Array.from(treeRef.current?.querySelectorAll<HTMLElement>("[data-explorer-row]") ?? []);
		rows[rows.indexOf(from) + step]?.focus();
	};

	const onRowKey = (e: KeyboardEvent<HTMLButtonElement>, entry: WorkspaceFile | null, rel: string, isOpen: boolean) => {
		const isDir = entry ? entry.is_dir : true;
		switch (e.key) {
			case "ArrowDown":
			case "ArrowUp":
				e.preventDefault();
				moveFocus(e.currentTarget, e.key === "ArrowDown" ? 1 : -1);
				break;
			case "ArrowRight":
				if (isDir && !isOpen) onToggleDir(rel);
				break;
			case "ArrowLeft":
				if (isDir && isOpen) onToggleDir(rel);
				break;
			case "F2":
			case "r":
				if (entry && !readOnly) onRename(entry);
				break;
			case "Delete":
			case "d":
				if (entry && !readOnly) onDelete(entry);
				break;
			// As in NvimTree: a adds a file next to (or inside) the row, y copies its path
			case "a":
				if (!readOnly) onNew("file", isDir ? rel : rel.split("/").slice(0, -1).join("/") || targetDir);
				break;
			case "y":
				onCopyPath?.(rel);
				break;
		}
	};

	const entryMenu = (entry: WorkspaceFile | null, rel: string): MenuEntry[] => {
		const isDir = entry ? entry.is_dir : true;
		const into = isDir ? rel : rel.split("/").slice(0, -1).join("/");
		return [
			...(!isDir ? [{ label: "Open", onSelect: () => onOpenFile(rel) }, ...(onOpenSide ? [{ label: "Open to the side", icon: <Columns3 className="size-4" />, shortcut: "Ctrl+Enter", onSelect: () => onOpenSide(rel) }] : []), "separator" as const] : []),
			...(!readOnly ? [{ label: "New file", icon: <FilePlus className="size-4" />, shortcut: "a", onSelect: () => onNew("file", into) }, { label: "New folder", icon: <FolderPlus className="size-4" />, onSelect: () => onNew("folder", into) }] : []),
			...(entry && !readOnly ? ["separator" as const, { label: "Rename", icon: <Pencil className="size-4" />, shortcut: "F2", onSelect: () => onRename(entry) }, { label: "Delete", icon: <Trash2 className="size-4" />, shortcut: "Del", danger: true, onSelect: () => onDelete(entry) }] : []),
			"separator" as const,
			{ label: "Copy path", icon: <Copy className="size-4" />, shortcut: "y", onSelect: () => onCopyPath?.(rel) },
		];
	};

	const renderDir = (dir: string): React.ReactNode =>
		(entries[dir] ?? [])
			.filter((entry) => !filtering || matches(entry.name) || (entry.is_dir && hasMatch(toRel(entry.path))))
			.map((entry) => {
				const rel = toRel(entry.path);
				const isOpen = filtering ? entry.is_dir && hasMatch(rel) : expanded.has(rel);
				const isActive = activePath === rel;
				return (
					<div key={entry.path}>
						<div
							onContextMenu={(e) => openMenu(e, entryMenu(entry, rel))}
							className={cn(
								"group flex items-center pr-1 text-sm hover:bg-muted/50",
								isActive && "bg-primary/10 shadow-[inset_2px_0_0_var(--color-primary)]",
								entry.is_dir && targetDir === rel && !filtering && "bg-muted/60",
							)}
						>
							<button
								type="button"
								data-explorer-row
								title={rel}
								className="flex min-w-0 flex-1 items-center gap-1.5 py-1 pl-2 text-left outline-none focus-visible:bg-muted"
								onClick={() => (entry.is_dir ? onToggleDir(rel) : onOpenFile(rel))}
								onKeyDown={(e) => (e.key === "Enter" && e.ctrlKey && !entry.is_dir ? onOpenSide?.(rel) : onRowKey(e, entry, rel, isOpen))}
							>
								{entry.is_dir ? (
									<>
										{isOpen ? <ChevronDown className="size-3 shrink-0" /> : <ChevronRight className="size-3 shrink-0" />}
										{isOpen ? (
											<FolderOpen className="size-3.5 shrink-0 text-primary/80" />
										) : (
											<Folder className="size-3.5 shrink-0 text-primary/80" />
										)}
									</>
								) : (
									<>
										<span className="w-3 shrink-0" />
										<FileKindIcon name={entry.name} className="size-3.5" />
									</>
								)}
								<span className={cn("truncate", isActive && "font-medium")}>{entry.name}</span>
									{!entry.is_dir && viewers && <PresenceDots names={viewers(rel)} />}
								{!entry.is_dir && openPaths.includes(rel) && (
									<span
										className={cn("ml-auto size-1.5 shrink-0", dirtyPaths.has(rel) ? "bg-warning" : "bg-muted-foreground/50")}
										aria-label={dirtyPaths.has(rel) ? "Open, unsaved changes" : "Open"}
									/>
								)}
							</button>
							{!readOnly && (
								<div className="flex shrink-0 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
									{entry.is_dir && (
										<>
											<Button variant="ghost" size="icon-xs" aria-label={`New file in ${entry.name}`} onPress={() => onNew("file", rel)}>
												<FilePlus />
											</Button>
											<Button variant="ghost" size="icon-xs" aria-label={`New folder in ${entry.name}`} onPress={() => onNew("folder", rel)}>
												<FolderPlus />
											</Button>
										</>
									)}
									<Button variant="ghost" size="icon-xs" aria-label={`Rename ${entry.name}`} onPress={() => onRename(entry)}>
										<Pencil />
									</Button>
									<Button variant="ghost" size="icon-xs" aria-label={`Delete ${entry.name}`} onPress={() => onDelete(entry)}>
										<Trash2 className="text-destructive" />
									</Button>
								</div>
							)}
						</div>
						{entry.is_dir && isOpen && (
							<div className="ml-3.5 border-l">
								{(entries[rel] ?? []).length === 0 && !filtering ? (
									<p className="py-1 pl-3 text-xs text-muted-foreground">Empty folder</p>
								) : (
									renderDir(rel)
								)}
							</div>
						)}
					</div>
				);
			});

	return (
		<div className="flex h-full min-w-0 flex-col bg-sidebar">
			<div className="flex items-center justify-between px-3 pt-3 pb-1">
				<h2 className="font-mono text-sm text-muted-foreground">explorer</h2>
				<div className="flex">
					{!readOnly && (
						<>
							<Button variant="ghost" size="icon-xs" aria-label="New file" onPress={() => onNew("file", targetDir)}>
								<FilePlus className="size-4" />
							</Button>
							<Button variant="ghost" size="icon-xs" aria-label="New folder" onPress={() => onNew("folder", targetDir)}>
								<FolderPlus className="size-4" />
							</Button>
						</>
					)}
					<Button variant="ghost" size="icon-xs" aria-label="Refresh files" onPress={onRefresh}>
						<RefreshCw className="size-3.5" />
					</Button>
					<Button variant="ghost" size="icon-xs" aria-label={`Export ${targetDir} as zip`} onPress={onExport}>
						<Download className="size-3.5" />
					</Button>
					<Button variant="ghost" size="icon-xs" aria-label="Collapse all folders" onPress={onCollapseAll}>
						<ChevronsDownUp className="size-3.5" />
					</Button>
				</div>
			</div>

			<div className="px-3 pb-2">
				<div className="relative">
					<Search className="pointer-events-none absolute top-1/2 left-2 size-3 -translate-y-1/2 text-muted-foreground" />
					<input
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						onKeyDown={(e) => e.key === "Escape" && setQuery("")}
						placeholder="Filter files"
						aria-label="Filter files"
						className="h-7 w-full border bg-background pr-6 pl-7 text-xs outline-none focus-visible:border-ring"
					/>
					{filtering && (
						<button
							type="button"
							aria-label="Clear filter"
							className="absolute top-1/2 right-1.5 -translate-y-1/2 text-muted-foreground hover:text-foreground"
							onClick={() => setQuery("")}
						>
							<X className="size-3" />
						</button>
					)}
				</div>
				{notice && (
					<p role={notice.ok ? "status" : "alert"} className={cn("mt-1.5 break-words text-xs", notice.ok ? "text-success" : "text-destructive")}>
						{notice.text}
					</p>
				)}
				{!readOnly && !filtering && (
					<p className="mt-1.5 truncate text-xs text-muted-foreground" title={`New files go in ${targetDir}`}>
						New items go in <span className="font-mono text-foreground">{targetDir}</span>
					</p>
				)}
			</div>

			<div ref={treeRef} className="flex-1 overflow-y-auto pb-3" role="tree" aria-label="Files">
				{roots.map((root) => {
					const isOpen = filtering ? hasMatch(root) : expanded.has(root);
					if (filtering && !isOpen) return null;
					return (
						<div key={root}>
							<div onContextMenu={(e) => openMenu(e, entryMenu(null, root))} className={cn("group flex items-center pr-1 hover:bg-muted/50", targetDir === root && !filtering && "bg-muted/60")}>
								<button
									type="button"
									data-explorer-row
									className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1 text-left text-xs font-semibold text-muted-foreground outline-none focus-visible:bg-muted"
									onClick={() => onToggleDir(root)}
									onKeyDown={(e) => onRowKey(e, null, root, isOpen)}
								>
									{isOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
									{root}
								</button>
								{!readOnly && (
									<div className="flex shrink-0 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
										<Button variant="ghost" size="icon-xs" aria-label={`New file in ${root}`} onPress={() => onNew("file", root)}>
											<FilePlus />
										</Button>
										<Button variant="ghost" size="icon-xs" aria-label={`New folder in ${root}`} onPress={() => onNew("folder", root)}>
											<FolderPlus />
										</Button>
									</div>
								)}
							</div>
							{isOpen &&
								((entries[root] ?? []).length === 0 && !filtering ? (
									<p className="px-6 py-1 text-xs text-muted-foreground">
										Empty.{!readOnly && " Use the + buttons to add a file."}
									</p>
								) : (
									renderDir(root)
								))}
						</div>
					);
				})}
				{filtering && !roots.some((root) => hasMatch(root)) && (
					<p className="px-3 py-2 text-xs text-muted-foreground">No files match “{query.trim()}”.</p>
				)}
			</div>
			{menu}
		</div>
	);
}
