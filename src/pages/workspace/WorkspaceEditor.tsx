import { useCallback, useEffect, useState } from "react";
import { Code2, Terminal, X } from "lucide-react";
import { UsersRound } from "@/components/animate-icons";

import CodeTab from "@/components/elements/editor/CodeTab";
import FileExplorer from "@/components/elements/editor/FileExplorer";
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
import { exportFolders } from "@/lib/export";
import { useErrorLog } from "@/hooks/useErrorLog";
import { useOpenParam } from "@/hooks/useOpenParam";
import { isBinaryFile, isDocumentFile } from "@/lib/editor/languages";
import {
	createWorkspaceFile,
	createWorkspaceFolder,
	deleteWorkspaceItem,
	listWorkspaceFiles,
	openWorkspaceFile,
	renameWorkspaceItem,
	renameYjsDoc,
} from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useIsViewer, useP2P } from "@/store/p2p/P2PContext";
import { useReportItem } from "@/hooks/usePresence";import { useWorkspace } from "@/store/workspace/WorkspaceContext";
import type { WorkspaceFile } from "@/types/workspace";

// Folders shown in the explorer: code lives in editor, and files holds anything else worth opening here
const ROOTS = ["editor", "files", "notes"];

const toRel = (path: string) => path.replace(/^\/+/, "");

interface NewItemDialog {
	kind: "file" | "folder";
	dir: string;
	value: string;
}

// Code editor tab: an explorer, several open files as tabs, blame and contributions, and run output
export default function WorkspaceEditor() {
	const { workspace, refreshStats, addActivityEvent } = useWorkspace();
	const isViewer = useIsViewer();
	const logError = useErrorLog();
	const { lastSyncedFile, viewersAt } = useP2P();
	const workspacePath = workspace?.path ?? "";

	const [expanded, setExpanded] = useState<Set<string>>(new Set(["editor"]));
	const [entries, setEntries] = useState<Record<string, WorkspaceFile[]>>({});
	const [targetDir, setTargetDir] = useState("editor");
	const [tabs, setTabs] = useState<string[]>([]);
	const [active, setActive] = useState<string | null>(null);
	useReportItem(active);
	const [dirty, setDirty] = useState<Set<string>>(new Set());
	const [showBlame, setShowBlame] = useState(false);
	const [showRun, setShowRun] = useState(true);
	const [newItem, setNewItem] = useState<NewItemDialog | null>(null);
	const [itemError, setItemError] = useState<string | null>(null);
	const [deleting, setDeleting] = useState<WorkspaceFile | null>(null);
	const [closing, setClosing] = useState<string | null>(null);
	const [exportNotice, setExportNotice] = useState<{ ok: boolean; text: string } | null>(null);
	const [renaming, setRenaming] = useState<{ entry: WorkspaceFile; value: string } | null>(null);

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
	}, [workspacePath]);

	const refresh = () => {
		for (const dir of new Set([...ROOTS, ...expanded])) void loadDir(dir);
	};

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

	const renameItem = async () => {
		if (!renaming || !workspacePath) return;
		const { entry } = renaming;
		const name = renaming.value.trim();
		if (!name) return setItemError("Name is required.");
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
			setTabs((prev) => prev.filter((p) => p !== rel && !p.startsWith(`${rel}/`)));
			setActive((current) => (current && (current === rel || current.startsWith(`${rel}/`)) ? null : current));
			await loadDir(rel.split("/").slice(0, -1).join("/"));
			void refreshStats();
			setDeleting(null);
		} catch (err) {
			logError(err, { source: "editor", workspace: workspacePath });
		}
	};

	return (
		<div className="flex h-[calc(100vh-10rem)] flex-col gap-4">
			{/* Header */}
			<div className="shrink-0">
				<h1 className="text-2xl font-bold tracking-tight">Editor</h1>
				<p className="mt-1 text-sm text-muted-foreground">Edit code and text files. Several can stay open as tabs, and everyone in the workspace edits the same file live.</p>
			</div>

			<div className="flex min-h-0 flex-1 border">
			<FileExplorer
				roots={ROOTS}
				entries={entries}
				expanded={expanded}
				targetDir={targetDir}
				activePath={active}
				openPaths={tabs}
				dirtyPaths={dirty}
				readOnly={isViewer}
				viewers={(rel) => viewersAt("editor", rel)}
				onToggleDir={toggleDir}
				onOpenFile={openPath}
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

			{/* Tabs, editor and run output */}
			<div className="flex min-w-0 flex-1 flex-col bg-background">
				<div className="flex min-h-11 items-stretch border-b">
					<div className="flex min-w-0 flex-1 overflow-x-auto">
						{tabs.map((path) => (
							<div
								key={path}
								className={cn(
									"group flex shrink-0 items-center gap-1.5 border-r px-3 text-xs",
									active === path ? "bg-background font-medium" : "bg-muted/30 text-muted-foreground hover:text-foreground",
								)}
							>
								<button type="button" onClick={() => setActive(path)} title={path} className="flex items-center gap-1.5">
									{path.split("/").pop()}
									{dirty.has(path) && <span className="size-1.5 bg-warning" aria-label="Unsaved changes" />}
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
							<div className="flex size-12 items-center justify-center bg-muted/60">
								<Code2 className="size-6 text-muted-foreground" />
							</div>
							<h3 className="mt-4 text-base font-semibold">Open a file to start editing</h3>
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

			{renaming && (
				<Dialog isOpen onOpenChange={(open) => !open && setRenaming(null)} className="max-w-md">
					<form
						className="space-y-4"
						onSubmit={(e) => {
							e.preventDefault();
							void renameItem();
						}}
					>
						<DialogHeader>
							<DialogTitle>Rename {renaming.entry.is_dir ? "Folder" : "File"}</DialogTitle>
							<DialogDescription>{toRel(renaming.entry.path)}</DialogDescription>
						</DialogHeader>
						<Input
							value={renaming.value}
							onChange={(e) => setRenaming({ ...renaming, value: e.target.value })}
							aria-label="New name"
							autoFocus
						/>
						{itemError && <p className="text-xs text-destructive">{itemError}</p>}
						<DialogFooter>
							<Button type="button" variant="outline" onPress={() => setRenaming(null)}>
								Cancel
							</Button>
							<Button type="submit">Rename</Button>
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
