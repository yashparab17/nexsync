import { useCallback, useEffect, useState } from "react";
import {
	ChevronDown,
	ChevronRight,
	Code2,
	File,
	FilePlus,
	Folder,
	FolderPlus,
	Terminal,
	Trash2,
	UsersRound,
	X,
} from "lucide-react";

import CodeTab from "@/components/elements/editor/CodeTab";
import RunPanel from "@/components/elements/editor/RunPanel";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useErrorLog } from "@/hooks/useErrorLog";
import { useOpenParam } from "@/hooks/useOpenParam";
import { isBinaryFile, isDocumentFile } from "@/lib/editor/languages";
import {
	createWorkspaceFile,
	createWorkspaceFolder,
	deleteWorkspaceItem,
	listWorkspaceFiles,
	openWorkspaceFile,
} from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useIsViewer, useP2P } from "@/store/p2p/P2PContext";
import { useWorkspace } from "@/store/workspace/WorkspaceContext";
import type { WorkspaceFile } from "@/types/workspace";

// Folders shown in the explorer: code lives in editor, and files holds anything else worth opening here
const ROOTS = ["editor", "files"];

const toRel = (path: string) => path.replace(/^\/+/, "");

interface NewItemDialog {
	kind: "file" | "folder";
	dir: string;
	value: string;
}

// Code editor tab: an explorer, several open files as tabs, blame and contributions, and run output
export default function WorkspaceEditor() {
	const { workspace, refreshStats } = useWorkspace();
	const isViewer = useIsViewer();
	const logError = useErrorLog();
	const { lastSyncedFile } = useP2P();
	const workspacePath = workspace?.path ?? "";

	const [expanded, setExpanded] = useState<Set<string>>(new Set(["editor"]));
	const [entries, setEntries] = useState<Record<string, WorkspaceFile[]>>({});
	const [targetDir, setTargetDir] = useState("editor");
	const [tabs, setTabs] = useState<string[]>([]);
	const [active, setActive] = useState<string | null>(null);
	const [dirty, setDirty] = useState<Set<string>>(new Set());
	const [showBlame, setShowBlame] = useState(false);
	const [showRun, setShowRun] = useState(true);
	const [newItem, setNewItem] = useState<NewItemDialog | null>(null);
	const [itemError, setItemError] = useState<string | null>(null);
	const [deleting, setDeleting] = useState<WorkspaceFile | null>(null);
	const [closing, setClosing] = useState<string | null>(null);

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

	const openPath = useCallback(
		(rel: string) => {
			const name = rel.split("/").pop() ?? rel;
			if (isBinaryFile(name) || isDocumentFile(name)) {
				openWorkspaceFile(workspacePath, rel).catch((err) => logError(err, { source: "editor", workspace: workspacePath }));
				return;
			}
			setTabs((prev) => (prev.includes(rel) ? prev : [...prev, rel]));
			setActive(rel);
		},
		[workspacePath, logError],
	);

	useOpenParam((path) => openPath(toRel(path)), !!workspacePath);

	// window.confirm is unreliable in the desktop webview, so unsaved tabs ask in a dialog
	const closeTab = (path: string) => {
		if (dirty.has(path)) return setClosing(path);
		discardTab(path);
	};

	const discardTab = (path: string) => {
		setClosing(null);
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

	const deleteItem = async () => {
		if (!deleting || !workspacePath) return;
		const rel = toRel(deleting.path);
		try {
			await deleteWorkspaceItem(workspacePath, rel);
			setTabs((prev) => prev.filter((p) => p !== rel && !p.startsWith(`${rel}/`)));
			setActive((current) => (current && (current === rel || current.startsWith(`${rel}/`)) ? null : current));
			await loadDir(rel.split("/").slice(0, -1).join("/"));
			void refreshStats();
			setDeleting(null);
		} catch (err) {
			logError(err, { source: "editor", workspace: workspacePath });
		}
	};

	const renderDir = (dir: string, depth: number): React.ReactNode =>
		(entries[dir] ?? []).map((entry) => {
			const rel = toRel(entry.path);
			const isOpen = expanded.has(rel);
			return (
				<div key={entry.path}>
					<div
						className={cn(
							"group flex items-center gap-1 py-1 pr-1 text-xs hover:bg-muted/50",
							active === rel && "bg-primary/10",
						)}
						style={{ paddingLeft: 8 + depth * 12 }}
					>
						<button
							type="button"
							className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
							onClick={() => (entry.is_dir ? toggleDir(rel) : openPath(rel))}
						>
							{entry.is_dir ? (
								<>
									{isOpen ? <ChevronDown className="size-3 shrink-0" /> : <ChevronRight className="size-3 shrink-0" />}
									<Folder className="size-3.5 shrink-0 text-primary/70" />
								</>
							) : (
								<File className="ml-4 size-3.5 shrink-0 text-muted-foreground" />
							)}
							<span className="truncate">{entry.name}</span>
						</button>
						{!isViewer && (
							<Button
								variant="ghost"
								size="icon-xs"
								className="opacity-0 group-hover:opacity-100"
								aria-label={`Delete ${entry.name}`}
								onPress={() => setDeleting(entry)}
							>
								<Trash2 className="size-3 text-destructive" />
							</Button>
						)}
					</div>
					{entry.is_dir && isOpen && renderDir(rel, depth + 1)}
				</div>
			);
		});

	return (
		<div className="-m-6 flex h-[calc(100vh-6rem)]">
			{/* Explorer */}
			<div className="flex w-52 shrink-0 flex-col border-r bg-muted/20 lg:w-64">
				<div className="flex items-center justify-between p-3">
					<div className="flex items-center gap-2">
						<Code2 className="size-5 text-primary" />
						<h2 className="text-base font-semibold">Editor</h2>
					</div>
					{!isViewer && (
						<div className="flex">
							<Button
								variant="ghost"
								size="icon-xs"
								aria-label="New file"
								onPress={() => {
									setItemError(null);
									setNewItem({ kind: "file", dir: targetDir, value: "" });
								}}
							>
								<FilePlus className="size-4" />
							</Button>
							<Button
								variant="ghost"
								size="icon-xs"
								aria-label="New folder"
								onPress={() => {
									setItemError(null);
									setNewItem({ kind: "folder", dir: targetDir, value: "" });
								}}
							>
								<FolderPlus className="size-4" />
							</Button>
						</div>
					)}
				</div>
				<div className="flex-1 overflow-y-auto pb-3">
					{ROOTS.map((root) => (
						<div key={root}>
							<button
								type="button"
								className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[11px] font-semibold uppercase tracking-widest text-muted-foreground hover:bg-muted/50"
								onClick={() => toggleDir(root)}
							>
								{expanded.has(root) ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
								{root}
							</button>
							{expanded.has(root) &&
								((entries[root] ?? []).length === 0 ? (
									<p className="px-6 py-1 text-xs text-muted-foreground">Empty</p>
								) : (
									renderDir(root, 1)
								))}
						</div>
					))}
				</div>
			</div>

			{/* Tabs, editor and run output */}
			<div className="flex min-w-0 flex-1 flex-col bg-background">
				<div className="flex items-stretch border-b">
					<div className="flex min-w-0 flex-1 overflow-x-auto">
						{tabs.map((path) => (
							<div
								key={path}
								className={cn(
									"group flex shrink-0 items-center gap-1.5 border-r px-3 py-2 text-xs",
									active === path ? "bg-background font-medium" : "bg-muted/30 text-muted-foreground hover:text-foreground",
								)}
							>
								<button type="button" onClick={() => setActive(path)} title={path} className="flex items-center gap-1.5">
									{path.split("/").pop()}
									{dirty.has(path) && <span className="size-1.5 bg-amber-400" aria-label="Unsaved changes" />}
								</button>
								<button type="button" aria-label={`Close ${path}`} onClick={() => closeTab(path)}>
									<X className="size-3" />
								</button>
							</div>
						))}
					</div>
					<div className="flex shrink-0 items-center gap-1 px-2">
						<Button variant={showBlame ? "secondary" : "ghost"} size="xs" onPress={() => setShowBlame((v) => !v)}>
							<UsersRound className="size-3.5" />
							Blame
						</Button>
						<Button variant={showRun ? "secondary" : "ghost"} size="xs" onPress={() => setShowRun((v) => !v)}>
							<Terminal className="size-3.5" />
							Run
						</Button>
					</div>
				</div>

				<div className="relative min-h-0 flex-1">
					{tabs.length === 0 && (
						<div className="flex h-full flex-col items-center justify-center p-8 text-center">
							<Code2 className="size-8 text-muted-foreground" />
							<h3 className="mt-3 text-base font-semibold">Open a file to start editing</h3>
							<p className="mt-1 max-w-sm text-xs text-muted-foreground">
								Pick a file in the explorer. Several files can stay open as tabs, and everyone in the workspace
								edits the same file live.
							</p>
						</div>
					)}
					{tabs.map((path) => (
						<div key={path} className={cn("absolute inset-0", active !== path && "hidden")}>
							<CodeTab path={path} active={active === path} readOnly={isViewer} showBlame={showBlame} onDirtyChange={onDirtyChange} />
						</div>
					))}
				</div>

				{showRun && (
					<div className="h-52 shrink-0 border-t">
						<RunPanel workspacePath={workspacePath} activePath={active} />
					</div>
				)}
			</div>

			{newItem && (
				<Dialog isOpen onOpenChange={(open) => !open && setNewItem(null)} className="max-w-md">
					<form
						className="space-y-4"
						onSubmit={(e) => {
							e.preventDefault();
							void createItem();
						}}
					>
						<DialogHeader>
							<DialogTitle>New {newItem.kind === "file" ? "File" : "Folder"}</DialogTitle>
							<DialogDescription>Created in /{newItem.dir}/</DialogDescription>
						</DialogHeader>
						<Input
							value={newItem.value}
							onChange={(e) => setNewItem({ ...newItem, value: e.target.value })}
							placeholder={newItem.kind === "file" ? "e.g. main.py" : "e.g. src"}
							autoFocus
						/>
						{itemError && <p className="text-xs text-destructive">{itemError}</p>}
						<DialogFooter>
							<Button type="button" variant="outline" onPress={() => setNewItem(null)}>
								Cancel
							</Button>
							<Button type="submit">Create</Button>
						</DialogFooter>
					</form>
				</Dialog>
			)}

			{closing && (
				<Dialog isOpen onOpenChange={(open) => !open && setClosing(null)}>
					<div className="space-y-4">
						<DialogHeader>
							<DialogTitle>Unsaved changes</DialogTitle>
							<DialogDescription>
								<span className="font-semibold text-foreground">{closing.split("/").pop()}</span> has changes that are
								not saved to the file. Close it anyway?
							</DialogDescription>
						</DialogHeader>
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
						<DialogHeader>
							<DialogTitle>Delete {deleting.is_dir ? "Folder" : "File"}</DialogTitle>
							<DialogDescription>
								Move <span className="font-semibold text-foreground">{deleting.name}</span> to the Trash? You can
								restore it from there.
							</DialogDescription>
						</DialogHeader>
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
