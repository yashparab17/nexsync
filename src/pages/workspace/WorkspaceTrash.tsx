import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Trash2, FileText, Folder, RotateCcw } from "@/components/animate-icons";

import { EmptyState, Page, PageBody } from "@/components/layout/Page";
import Toolbar, { ToolbarTitle } from "@/components/layout/Toolbar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogHeading } from "@/components/ui/dialog";

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
		<Page>
			<Toolbar>
				<ToolbarTitle name="Trash" meta={items.length ? `${items.length} ${items.length === 1 ? "item" : "items"}` : undefined} />
				<span className="ml-1 hidden min-w-0 flex-1 truncate border-l pl-3 text-sm text-muted-foreground md:block">Deleted files and folders, including ones removed by collaborators</span>
				<span className="flex-1 md:hidden" />
				{!isViewer && items.length > 0 && (
					<Button variant="outline" size="sm" onPress={() => setConfirm("all")}>
						<Trash2 className="size-4" />
						Empty trash
					</Button>
				)}
			</Toolbar>

			<PageBody padded={false}>
				{message && <p className="border-b px-3 py-2 text-sm text-destructive">{message}</p>}
				{loading ? (
					<div className="flex h-32 items-center justify-center">
						<Loader2 className="size-5 animate-spin text-muted-foreground" />
					</div>
				) : items.length === 0 ? (
					<EmptyState icon={<Trash2 />} title="Trash is empty">
						Deleted files and folders wait here until you restore them or remove them for good.
					</EmptyState>
				) : (
					<ul className="divide-y">
						{items.map((item) => (
							<li key={item.id} className="group flex items-center gap-3 px-3 py-2.5">
								{item.isDir ? <Folder className="size-4 shrink-0 text-warning" /> : <FileText className="size-4 shrink-0 text-info" />}
								<div className="min-w-0 flex-1">
									<p className="truncate font-mono text-xs">{item.relPath}</p>
									<p className="text-sm text-muted-foreground">
										{formatBytes(item.size)} · deleted {new Date(item.deletedAt).toLocaleString()}
									</p>
								</div>
								{!isViewer && (
									<div className="flex shrink-0 items-center gap-2">
										<Button variant="outline" size="sm" onPress={() => run(() => restoreTrashItem(path, item.id))}>
											<RotateCcw className="size-3.5" />
											Restore
										</Button>
										<Button variant="ghost" size="icon-xs" onPress={() => setConfirm(item)} aria-label={`Delete ${item.relPath} permanently`}>
											<Trash2 className="size-3.5 text-destructive" />
										</Button>
									</div>
								)}
							</li>
						))}
					</ul>
				)}
			</PageBody>

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
						<DialogHeading icon={<Trash2 className="size-6" />} tone="danger" title="Delete permanently" description={<>{confirm === "all"
									? "Everything in the trash will be removed for good."
									: `${confirm.relPath} will be removed for good.`}{" "}
								This cannot be undone.</>} />
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
		</Page>
	);
}
