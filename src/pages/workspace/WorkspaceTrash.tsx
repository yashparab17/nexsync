import { useCallback, useEffect, useState } from "react";
import { FileText, Folder, Loader2, RotateCcw } from "lucide-react";
import { Trash2 } from "@/components/animate-icons";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";

import { useErrorLog } from "@/hooks/useErrorLog";
import { emptyTrash, eraseFileForGood, listTrash, purgeTrashItem, restoreTrashItem } from "@/lib/tauri";
import EraseOption from "@/components/elements/EraseOption";
import { errorText, formatBytes } from "@/lib/utils";
import { useWorkspace } from "@/store/workspace/WorkspaceContext";
import { useIsViewer, useP2P } from "@/store/p2p/P2PContext";
import type { TrashItem } from "@/types/workspace";

// Deleted files and folders that can be restored or permanently removed
export default function WorkspaceTrash() {
	const { workspace, refreshStats } = useWorkspace();
	const isViewer = useIsViewer();
	const { publishDataChange } = useP2P();
	const logError = useErrorLog();
	const path = workspace?.path ?? "";

	const [items, setItems] = useState<TrashItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [message, setMessage] = useState<string | null>(null);
	const [confirm, setConfirm] = useState<TrashItem | "all" | null>(null);
	const [erase, setErase] = useState(false);

	const load = useCallback(async () => {
		if (!path) return;
		try {
			setItems(await listTrash(path));
		} catch (err) {
			logError(err, { source: "files", workspace: path });
		} finally {
			setLoading(false);
		}
	}, [path, logError]);

	useEffect(() => {
		void load();
	}, [load]);

	const run = async (action: () => Promise<void>) => {
		setMessage(null);
		try {
			await action();
			await load();
			void refreshStats();
		} catch (err) {
			setMessage(errorText(err, "That action failed."));
		}
	};

	const doConfirmed = async () => {
		const target = confirm;
		const eraseIt = erase;
		setConfirm(null);
		setErase(false);
		if (target === "all") await run(() => emptyTrash(path));
		else if (target && eraseIt) {
			await run(async () => {
				await eraseFileForGood(path, target.relPath);
				publishDataChange({ entity: "file", op: "erase", path: target.relPath, docIds: [] });
			});
		} else if (target) await run(() => purgeTrashItem(path, target.id));
	};

	return (
		<div className="space-y-6">
			<div className="flex items-start justify-between gap-4">
				<div>
					<h1 className="text-2xl font-bold tracking-tight">Trash</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						Deleted files and folders, including ones removed by collaborators. Restore them or remove them for good.
					</p>
				</div>
				{!isViewer && items.length > 0 && (
					<Button variant="outline" size="sm" onPress={() => setConfirm("all")} className="gap-1.5">
						<Trash2 className="size-3.5" />
						Empty Trash
					</Button>
				)}
			</div>

			{message && <p className="text-sm text-destructive">{message}</p>}

			{loading ? (
				<div className="flex h-32 items-center justify-center">
					<Loader2 className="size-5 animate-spin text-muted-foreground" />
				</div>
			) : items.length === 0 ? (
				<div className="border border-dashed p-12 text-center text-sm text-muted-foreground">
					Trash is empty.
				</div>
			) : (
				<ul className="divide-y border">
					{items.map((item) => (
						<li key={item.id} className="flex items-center gap-3 px-4 py-3">
							{item.isDir ? (
								<Folder className="size-4 shrink-0 text-warning" />
							) : (
								<FileText className="size-4 shrink-0 text-info" />
							)}
							<div className="min-w-0 flex-1">
								<p className="truncate text-sm font-medium">{item.relPath}</p>
								<p className="text-xs text-muted-foreground">
									{formatBytes(item.size)} • Deleted {new Date(item.deletedAt).toLocaleString()}
								</p>
							</div>
							{!isViewer && (
								<div className="flex shrink-0 gap-2">
									<Button
										variant="outline"
										size="sm"
										onPress={() => run(() => restoreTrashItem(path, item.id))}
										className="gap-1.5"
									>
										<RotateCcw className="size-3.5" />
										Restore
									</Button>
									<Button
										variant="ghost"
										size="icon-xs"
										onPress={() => setConfirm(item)}
										aria-label={`Delete ${item.relPath} permanently`}
									>
										<Trash2 className="size-3.5 text-destructive" />
									</Button>
								</div>
							)}
						</li>
					))}
				</ul>
			)}

			{confirm && (
				<Dialog
					isOpen
					onOpenChange={(open) => {
						if (!open) {
							setConfirm(null);
							setErase(false);
						}
					}}
				>
					<div className="space-y-4">
						<DialogHeader>
							<DialogTitle>Delete Permanently</DialogTitle>
							<DialogDescription>
								{confirm === "all"
									? "Everything in the trash will be removed for good."
									: `${confirm.relPath} will be removed for good.`}{" "}
								This cannot be undone.
							</DialogDescription>
						</DialogHeader>
						{confirm !== "all" && <EraseOption checked={erase} onChange={setErase} what={confirm.relPath} />}
						<DialogFooter>
							<Button
								variant="outline"
								onPress={() => {
									setConfirm(null);
									setErase(false);
								}}
							>
								Cancel
							</Button>
							<Button variant="destructive" onPress={doConfirmed}>
								{erase && confirm !== "all" ? "Erase" : "Delete"}
							</Button>
						</DialogFooter>
					</div>
				</Dialog>
			)}
		</div>
	);
}
