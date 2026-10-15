// Moving a workspace between devices with no network: Export writes a signed bundle file that can go on a USB stick or in a
// shared folder; Import reads one, shows what is in it and who made it, checks it like anything that arrives over a link, and
// merges it. A bundle from a removed member is refused, and an old one cannot bring back a member who was removed since.

import { useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import * as Y from "yjs";

import { Download, FileUp, Upload } from "@/components/animate-icons";
import Art from "@/components/elements/Art";
import { Button } from "@/components/ui/button";
import { Dialog, DialogHeading } from "@/components/ui/dialog";
import { base64ToUint8Array, bundleExport, bundleImport, bundleInspect, getYjsDoc, saveYjsDoc, type BundleSummary } from "@/lib/tauri";
import { formatBytes } from "@/lib/utils";
import { useChat } from "@/store/chat/ChatContext";
import { useP2P } from "@/store/p2p/P2PContext";
import { useWorkspace } from "@/store/workspace/WorkspaceContext";

const FILTER = [{ name: "Nexsync bundle", extensions: ["nexbundle"] }];

export default function BundleCard() {
	const { workspace } = useWorkspace();
	const { refreshData } = useP2P();
	const chat = useChat();
	const path = workspace?.path;
	const [busy, setBusy] = useState(false);
	const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
	const [pending, setPending] = useState<{ source: string; summary: BundleSummary } | null>(null);

	const nameOf = (key: string) => chat.people.find((p) => p.deviceId === key)?.name ?? `device ${key.slice(0, 8)}`;

	const exportBundle = async () => {
		if (!path) return;
		const dest = await save({ title: "Save a bundle", defaultPath: `${workspace?.name ?? "workspace"}.nexbundle`, filters: FILTER });
		if (!dest) return;
		setBusy(true);
		setNotice(null);
		try {
			const size = await bundleExport(path, dest.toLowerCase().endsWith(".nexbundle") ? dest : `${dest}.nexbundle`);
			setNotice({ ok: true, text: `Saved a bundle of ${formatBytes(size)}. Put it on a USB stick or in a shared folder; anyone in the workspace can import it.` });
		} catch (err) {
			setNotice({ ok: false, text: err instanceof Error ? err.message : String(err) });
		} finally {
			setBusy(false);
		}
	};

	const pick = async () => {
		if (!path) return;
		const source = await open({ title: "Choose a bundle", multiple: false, filters: FILTER });
		if (typeof source !== "string") return;
		setBusy(true);
		setNotice(null);
		try {
			setPending({ source, summary: await bundleInspect(path, source) });
		} catch (err) {
			setNotice({ ok: false, text: err instanceof Error ? err.message : String(err) });
		} finally {
			setBusy(false);
		}
	};

	const apply = async () => {
		if (!path || !pending) return;
		setBusy(true);
		try {
			const report = await bundleImport(path, pending.source);
			// The texts are merged here, where the Yjs library is: each one's stored state takes the bundle's updates
			let docs = 0;
			for (const [doc, state] of report.docs) {
				try {
					const ydoc = new Y.Doc();
					const mine = await getYjsDoc(path, doc);
					if (mine) Y.applyUpdate(ydoc, mine);
					Y.applyUpdate(ydoc, base64ToUint8Array(state));
					await saveYjsDoc(path, doc, Y.encodeStateAsUpdate(ydoc));
					docs++;
				} catch {
					/* a state that does not apply is skipped; the files and the rest are in */
				}
			}
			refreshData();
			setPending(null);
			setNotice({
				ok: true,
				text: `Imported ${report.entriesAdded} messages and notices, ${report.filesWritten} new files and ${docs} shared texts${report.dataChanged ? ", and the task and card changes" : ""}. ${report.entriesRefused > 0 ? `${report.entriesRefused} entries were refused by the checks. ` : ""}${report.listTaken ? "The bundle carried a newer member list, which was taken: restart Nexsync so every part of it uses that list. " : ""}${report.filesKept > 0 ? `${report.filesKept} files you already have were left as they are.` : ""}`,
			});
		} catch (err) {
			setNotice({ ok: false, text: err instanceof Error ? err.message : String(err) });
			setPending(null);
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="space-y-4">
			<Art name="bundle" className="mx-auto h-36 w-44" />
			<p className="text-sm text-muted-foreground">For a room with no network: a signed file with the member list, the chat and notices, tasks and cards, files and shared texts. Importing checks it as if it had come over a link, so a bundle from someone who was removed is refused.</p>
			<div className="flex flex-wrap gap-2">
				<Button variant="outline" size="sm" isDisabled={busy || !path} onPress={() => void exportBundle()}>
					<Download className="size-3.5" />
					Export a Bundle
				</Button>
				<Button variant="outline" size="sm" isDisabled={busy || !path} onPress={() => void pick()}>
					<Upload className="size-3.5" />
					Import a Bundle
				</Button>
			</div>
			{notice && (
				<p role={notice.ok ? "status" : "alert"} className={notice.ok ? "bg-success/10 p-2 text-sm text-success" : "bg-destructive/10 p-2 text-sm text-destructive"}>
					{notice.text}
				</p>
			)}
			{pending && (
				<Dialog isOpen onOpenChange={(o) => !o && !busy && setPending(null)} className="sm:max-w-md">
					<div className="flex flex-col gap-4">
						<DialogHeading icon={<FileUp className="size-6" />} title="Import This Bundle?" description={`Made by ${nameOf(pending.summary.by)} on ${new Date(pending.summary.created).toLocaleString()}. Its signature and member list checked out.`} />
						<dl className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[13px]">
							<dt className="text-muted-foreground">Messages and notices</dt>
							<dd>{pending.summary.entries}</dd>
							<dt className="text-muted-foreground">Tasks and cards</dt>
							<dd>
								{pending.summary.tasks} and {pending.summary.cards}
							</dd>
							<dt className="text-muted-foreground">Files</dt>
							<dd>
								{pending.summary.files}
								{pending.summary.skipped > 0 ? ` (${pending.summary.skipped} too large, left out)` : ""}
							</dd>
							<dt className="text-muted-foreground">Shared texts</dt>
							<dd>{pending.summary.docs}</dd>
						</dl>
						{pending.summary.newerList && <p className="text-sm text-warning">It carries a newer member list than this device has; it will be taken.</p>}
						<div className="flex justify-end gap-2">
							<Button variant="ghost" isDisabled={busy} onPress={() => setPending(null)}>
								Cancel
							</Button>
							<Button isDisabled={busy} onPress={() => void apply()}>
								Import
							</Button>
						</div>
					</div>
				</Dialog>
			)}
		</div>
	);
}
