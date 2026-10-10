// Notes a task or card points at by writing [[Note name]] in its description

import { useEffect, useState } from "react";
import { FileText } from "@/components/animate-icons";
import { useNavigate } from "react-router-dom";

import { extractLinks, noteTitle, resolveLink } from "@/lib/notes/links";
import { listWorkspaceFiles } from "@/lib/tauri";
import { useWorkspace } from "@/store/workspace/WorkspaceContext";
import type { WorkspaceFile } from "@/types/workspace";

export default function NoteLinks({ text }: { text: string }) {
	const { workspace } = useWorkspace();
	const navigate = useNavigate();
	const [notes, setNotes] = useState<WorkspaceFile[]>([]);
	const links = extractLinks(text);
	const hasLinks = links.length > 0;

	useEffect(() => {
		if (!hasLinks || !workspace?.path) return;
		let live = true;
		listWorkspaceFiles(workspace.path, "notes")
			.then((files) => live && setNotes(files.filter((f) => !f.is_dir)))
			.catch(() => {});
		return () => {
			live = false;
		};
	}, [hasLinks, workspace?.path]);

	return (
		<div className="mt-1.5 space-y-1">
			{hasLinks && (
				<div className="flex flex-wrap gap-1.5">
					{links.map((target) => {
						const note = resolveLink(target, notes);
						return note ? (
							<button
								key={target}
								type="button"
								onClick={() => navigate(`/workspace/notes?open=${encodeURIComponent(note.path)}`)}
								className="inline-flex cursor-pointer items-center gap-1 border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-xs hover:bg-primary/20"
							>
								<FileText className="size-3" />
								{noteTitle(note.name)}
							</button>
						) : (
							<span key={target} className="inline-flex items-center gap-1 border border-dashed border-border px-1.5 py-0.5 text-xs text-muted-foreground">
								<FileText className="size-3" />
								{target} (no such note)
							</span>
						);
					})}
				</div>
			)}
			<p className="text-xs text-muted-foreground">Link a note by writing [[Note name]] in the description.</p>
		</div>
	);
}
