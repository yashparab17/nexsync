// The top of the sidebar's list: a New menu (a document, sheet, deck or note) and the files opened most recently, across the office
// editors, notes and the code editor.

import { ChevronDown, FilePlus } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { editorRouteFor } from "@/lib/editor/languages";
import { routeOf } from "@/lib/p2p/presence";
import { useRecent } from "@/lib/recentFiles";
import { cn } from "@/lib/utils";
import { useIsViewer } from "@/store/p2p/P2PContext";
import { useWorkspace } from "@/store/workspace/WorkspaceContext";

const NEW_ITEMS = [
	["Document", "documents"],
	["Sheet", "sheets"],
	["Slides", "slides"],
	["Note", "notes"],
] as const;

const PAGE_OF: Record<string, string> = { notes: "notes", documents: "documents", sheets: "sheets", slides: "slides", editor: "editor", system: "others" };

export default function SidebarQuick({ onNavigate }: { onNavigate?: () => void }) {
	const { workspace } = useWorkspace();
	const isViewer = useIsViewer();
	const navigate = useNavigate();
	const [open, setOpen] = useState(false);
	const recent = useRecent(workspace?.path).slice(0, 5);

	return (
		<div className="flex flex-col gap-0.5">
			{!isViewer && (
				<>
					<button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-foreground outline-none hover:bg-muted focus-visible:bg-muted">
						<FilePlus className="size-5 shrink-0" aria-hidden />
						New
						<ChevronDown className={cn("ml-auto size-3.5 transition-transform", open && "rotate-180")} aria-hidden />
					</button>
					{open && (
						<ul aria-label="New" className="mb-1 ml-5 flex flex-col border-l pl-2">
							{NEW_ITEMS.map(([label, page]) => (
								<li key={page}>
									<button
										type="button"
										onClick={() => {
											setOpen(false);
											navigate(`${routeOf(page)}?new=1`);
											onNavigate?.();
										}}
										className="w-full rounded-md px-3 py-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted"
									>
										{label}
									</button>
								</li>
							))}
						</ul>
					)}
				</>
			)}
			{recent.length > 0 && (
				<div className="mt-1">
					<p className="px-3 pb-1 font-mono text-xs text-muted-foreground">Recent</p>
					<ul>
						{recent.map((path) => (
							<li key={path}>
								<Link
									to={`${routeOf(PAGE_OF[editorRouteFor(path.split("/").pop() ?? "")] ?? "editor")}?open=${encodeURIComponent(path)}`}
									onClick={onNavigate}
									title={path}
									className="block truncate rounded-md px-3 py-1.5 text-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:bg-muted"
								>
									{path.split("/").pop()}
								</Link>
							</li>
						))}
					</ul>
				</div>
			)}
		</div>
	);
}
