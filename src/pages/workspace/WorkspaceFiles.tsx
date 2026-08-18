import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Dialog,
	DialogHeader,
	DialogTitle,
	DialogDescription,
	DialogFooter,
} from "@/components/ui/dialog";

import { useWorkspace } from "@/store/workspace/WorkspaceContext";
import { useErrorLog } from "@/hooks/useErrorLog";
import {
	listWorkspaceFiles,
	createWorkspaceFolder,
	deleteWorkspaceEntry,
	renameWorkspaceEntry,
	importFilesIntoWorkspace,
	exportWorkspaceFile,
} from "@/lib/tauri";

import type { WorkspaceFile } from "@/types/workspace";

type DialogState =
	| { type: "create" }
	| { type: "rename"; entry: WorkspaceFile }
	| { type: "delete"; entry: WorkspaceFile }
	| null;

export default function WorkspaceFiles() {
	const { workspace } = useWorkspace();
	const logError = useErrorLog();

	const [currentPath, setCurrentPath] = useState("");
	const [entries, setEntries] = useState<WorkspaceFile[]>([]);
	const [loading, setLoading] = useState(false);
	const [dialog, setDialog] = useState<DialogState>(null);
	const [newFolderName, setNewFolderName] = useState("");
	const [renameName, setRenameName] = useState("");

	const refresh = useCallback(async () => {
		if (!workspace) return;
		setLoading(true);
		try {
			const data = await listWorkspaceFiles(
				workspace.path,
				"files",
				currentPath,
			);
			setEntries(data);
		} catch (err) {
			logError(err, { source: "files_list" });
		} finally {
			setLoading(false);
		}
	}, [workspace, currentPath, logError]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const openItem = (entry: WorkspaceFile) => {
		if (entry.is_dir) {
			const newPath = entry.path.replace(/^\/files\//, "");
			setCurrentPath(newPath);
		}
	};

	const handleCreateFolder = async () => {
		if (!workspace || !newFolderName.trim()) return;

		const name = newFolderName.trim();
		const target = currentPath
			? `${currentPath}/${name}`
			: name;

		try {
			await createWorkspaceFolder(workspace.path, "files", target);
			setDialog(null);
			setNewFolderName("");
			void refresh();
		} catch (err) {
			logError(err, { source: "files_create" });
		}
	};

	const handleRename = async () => {
		if (!workspace || !dialog || dialog.type !== "rename") return;
		if (!renameName.trim()) return;

		const oldPath = dialog.entry.path.replace(/^\/files\//, "");
		const newPath = currentPath
			? `${currentPath}/${renameName.trim()}`
			: renameName.trim();

		try {
			await renameWorkspaceEntry(
				workspace.path,
				"files",
				oldPath,
				newPath,
			);
			setDialog(null);
			setRenameName("");
			void refresh();
		} catch (err) {
			logError(err, { source: "files_rename" });
		}
	};

	const handleDelete = async () => {
		if (!workspace || !dialog || dialog.type !== "delete") return;

		const relative = dialog.entry.path.replace(/^\/files\//, "");

		try {
			await deleteWorkspaceEntry(workspace.path, "files", relative);
			setDialog(null);
			void refresh();
		} catch (err) {
			logError(err, { source: "files_delete" });
		}
	};

	const handleUpload = async () => {
		if (!workspace) return;

		try {
			await importFilesIntoWorkspace(
				workspace.path,
				"files",
				currentPath,
			);
			void refresh();
		} catch (err) {
			logError(err, { source: "files_upload" });
		}
	};

	const handleExport = async (entry: WorkspaceFile) => {
		if (!workspace || entry.is_dir) return;

		const relative = entry.path.replace(/^\/files\//, "");

		try {
			await exportWorkspaceFile(workspace.path, "files", relative);
		} catch (err) {
			logError(err, { source: "files_export" });
		}
	};

	const crumbs = currentPath.split("/").filter(Boolean);

	return (
		<div className="flex h-full flex-col p-6">
			<div className="flex items-center justify-between">
				<h1 className="text-2xl font-semibold">Files</h1>
				<div className="flex items-center gap-2">
					<Button size="sm" onPress={() => setDialog({ type: "create" })}>
						New Folder
					</Button>
					<Button size="sm" variant="outline" onPress={handleUpload}>
						Upload
					</Button>
					<Button size="sm" variant="ghost" onPress={() => void refresh()}>
						Refresh
					</Button>
				</div>
			</div>

			{/* Breadcrumbs */}
			<div className="mt-4 flex items-center gap-1 text-sm text-muted-foreground">
				<button
					className="hover:text-foreground"
					onClick={() => setCurrentPath("")}
				>
					Files
				</button>
				{crumbs.map((crumb, index) => (
					<button
						key={`${crumb}-${index}`}
						className="hover:text-foreground"
						onClick={() =>
							setCurrentPath(
								crumbs.slice(0, index + 1).join("/"),
							)
						}
					>
						<span>/</span>
						<span>{crumb}</span>
					</button>
				))}
			</div>

			{/* File list */}
			<div className="mt-4 flex-1 overflow-auto rounded border">
				{loading ? (
					<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
						Loading…
					</div>
				) : entries.length === 0 ? (
					<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
						This folder is empty.
					</div>
				) : (
					<table className="w-full text-left text-sm">
						<thead className="border-b bg-muted/30">
							<tr>
								<th className="px-4 py-2 font-medium">Name</th>
								<th className="hidden px-4 py-2 font-medium sm:table-cell">
									Type
								</th>
								<th className="hidden px-4 py-2 font-medium md:table-cell">
									Size
								</th>
								<th className="hidden px-4 py-2 font-medium md:table-cell">
									Modified
								</th>
								<th className="px-4 py-2" />
							</tr>
						</thead>
						<tbody>
							{entries.map((entry) => (
								<tr
									key={entry.path}
									className="border-b last:border-b-0 hover:bg-muted/30"
								>
									<td
										className="cursor-pointer px-4 py-2"
										onClick={() => openItem(entry)}
									>
										{entry.name}
									</td>
									<td className="hidden px-4 py-2 sm:table-cell">
										{entry.is_dir ? "Folder" : "File"}
									</td>
									<td className="hidden px-4 py-2 md:table-cell">
										{entry.is_dir ? "—" : entry.size}
									</td>
									<td className="hidden px-4 py-2 md:table-cell">
										{entry.modified_at
											? new Date(entry.modified_at).toLocaleString()
											: "—"}
									</td>
									<td className="px-4 py-2">
										<div className="flex justify-end gap-2">
											{!entry.is_dir && (
												<Button
													variant="ghost"
													size="sm"
													onPress={() => handleExport(entry)}
												>
													Export
												</Button>
											)}
											<Button
												variant="ghost"
												size="sm"
												onPress={() => {
													setRenameName(entry.name);
													setDialog({ type: "rename", entry });
												}}
											>
												Rename
											</Button>
											<Button
												variant="destructive"
												size="sm"
												onPress={() => setDialog({ type: "delete", entry })}
											>
												Delete
											</Button>
										</div>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</div>

			{/* New folder dialog */}
			<Dialog
				open={dialog?.type === "create"}
				onOpenChange={(open) => {
					if (!open) setDialog(null);
				}}
			>
				<DialogHeader>
					<DialogTitle>New Folder</DialogTitle>
					<DialogDescription>
						Enter a name for the new folder.
					</DialogDescription>
				</DialogHeader>
				<Input
					value={newFolderName}
					onChange={(e) => setNewFolderName(e.target.value)}
					placeholder="folder name"
				/>
				<DialogFooter>
					<Button variant="outline" onPress={() => setDialog(null)}>
						Cancel
					</Button>
					<Button onPress={handleCreateFolder}>Create</Button>
				</DialogFooter>
			</Dialog>

			{/* Rename dialog */}
			<Dialog
				open={dialog?.type === "rename"}
				onOpenChange={(open) => {
					if (!open) setDialog(null);
				}}
			>
				<DialogHeader>
					<DialogTitle>Rename</DialogTitle>
					<DialogDescription>
						Enter a new name for this item.
					</DialogDescription>
				</DialogHeader>
				<Input
					value={renameName}
					onChange={(e) => setRenameName(e.target.value)}
					placeholder="new name"
				/>
				<DialogFooter>
					<Button variant="outline" onPress={() => setDialog(null)}>
						Cancel
					</Button>
					<Button onPress={handleRename}>Rename</Button>
				</DialogFooter>
			</Dialog>

			{/* Delete dialog */}
			<Dialog
				open={dialog?.type === "delete"}
				onOpenChange={(open) => {
					if (!open) setDialog(null);
				}}
			>
				<DialogHeader>
					<DialogTitle>Delete</DialogTitle>
					<DialogDescription>
						Are you sure you want to delete{" "}
						{dialog?.type === "delete" ? dialog.entry.name : ""}?
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button variant="outline" onPress={() => setDialog(null)}>
						Cancel
					</Button>
					<Button variant="destructive" onPress={handleDelete}>
						Delete
					</Button>
				</DialogFooter>
			</Dialog>
		</div>
	);
}
