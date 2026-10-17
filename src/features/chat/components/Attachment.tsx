// A file attached to a message: a picture shows in place, anything else is a chip that saves it. The file lives in the
// workspace's assets/chat folder and reaches other devices the way every asset does; until it has, there is a Download button.

import { useEffect, useState } from "react";
import { AnimateIcon, Download, Paperclip } from "@/components/animate-icons";

import { readWorkspaceBinaryFile } from "@/lib/tauri";
import { getMimeType } from "@/lib/utils";
import { useP2P } from "@/store/p2p/P2PContext";
import { useWorkspace } from "@/store/workspace/WorkspaceContext";

export const MAX_ATTACHMENT = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS = 5;

// "ab12cd34-photo.png" is shown as "photo.png"
export const attachmentName = (path: string) => (path.split("/").pop() ?? path).replace(/^[0-9a-f]{8}-/, "");

export default function Attachment({ path }: { path: string }) {
	const { workspace } = useWorkspace();
	const { downloadFileOnDemand } = useP2P();
	const name = attachmentName(path);
	const mime = getMimeType(name);
	const [data, setData] = useState<string | null>(null);
	const [missing, setMissing] = useState(false);
	const [busy, setBusy] = useState(false);

	const load = async () => {
		if (!workspace?.path) return;
		try {
			setData(await readWorkspaceBinaryFile(workspace.path, path));
			setMissing(false);
		} catch {
			setMissing(true);
		}
	};
	useEffect(() => {
		void load();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [workspace?.path, path]);

	const fetchIt = async () => {
		setBusy(true);
		try {
			await downloadFileOnDemand(path);
			await load();
		} catch {
			/* still not here: the button stays */
		} finally {
			setBusy(false);
		}
	};
	const save = () => {
		if (!data) return;
		const a = document.createElement("a");
		a.href = `data:${mime};base64,${data}`;
		a.download = name;
		a.click();
	};

	if (missing || !data) {
		return (
			<span className="my-1 inline-flex h-8 items-center gap-2 rounded-md bg-muted px-2 text-[13px]">
				<Paperclip className="size-3.5" />
				{name}
				{missing && (
					<AnimateIcon animateOnHover asChild>
						<button type="button" disabled={busy} onClick={() => void fetchIt()} className="flex cursor-pointer items-center gap-1 text-primary outline-none disabled:opacity-60">
							<Download className="size-3.5" />
							{busy ? "Downloading…" : "Not on this device yet. Download"}
						</button>
					</AnimateIcon>
				)}
			</span>
		);
	}
	if (mime.startsWith("image/") && mime !== "image/svg+xml") {
		return (
			<span className="my-1 block">
				<img src={`data:${mime};base64,${data}`} alt={name} className="max-h-80 max-w-full rounded-md" />
				<button type="button" onClick={save} className="mt-1 cursor-pointer font-mono text-[13px] text-muted-foreground hover:text-foreground">
					{name} · Save
				</button>
			</span>
		);
	}
	return (
		<AnimateIcon animateOnHover asChild>
			<button type="button" onClick={save} className="my-1 inline-flex h-8 cursor-pointer items-center gap-2 rounded-md bg-muted px-2 text-[13px] outline-none hover:bg-muted/70 focus-visible:bg-muted/70">
				<Paperclip className="size-3.5" />
				{name}
				<Download className="size-3.5 text-muted-foreground" />
			</button>
		</AnimateIcon>
	);
}
