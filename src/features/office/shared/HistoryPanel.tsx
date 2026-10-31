import { History } from "lucide-react";
import { useState } from "react";

import FileHistoryDialog from "@/components/dialogs/workspace/FileHistoryDialog";
import { Button } from "@/components/ui/button";

// The File tab's Version History: the saved versions of the file on disk (each save and each update of the file keeps one), with
// restore. A restore puts the older file back on disk; the open copy is the shared document, so it is brought in by reopening or
// by Reload from File.
export default function HistoryPanel({ workspacePath, rel, readOnly }: { workspacePath: string; rel: string; readOnly: boolean }) {
	const [open, setOpen] = useState(false);
	const [restored, setRestored] = useState(false);
	return (
		<div className="max-w-md space-y-3 text-sm">
			<h2 className="text-2xl font-light">Version History</h2>
			<p>Each save keeps a version. Compare them, or put an older one back.</p>
			<Button variant="outline" onPress={() => setOpen(true)}>
				<History className="size-4" /> Show Versions
			</Button>
			{restored && <p role="status">The older file is back on disk. Reopen it, or use Reload from File, to see it here.</p>}
			{open && <FileHistoryDialog workspacePath={workspacePath} path={rel.replace(/^\/+/, "")} readOnly={readOnly} onRestored={() => setRestored(true)} onClose={() => setOpen(false)} />}
		</div>
	);
}
