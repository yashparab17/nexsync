// Outline, outgoing [[links]] and backlinks for the open note

import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Link2, ListTree } from "lucide-react";

import { extractHeadings, extractLinks, findBacklinks, resolveLink, type NoteRef } from "@/lib/notes/links";
import { readWorkspaceFile } from "@/lib/tauri";

// Backlinks read every other note, so a very large workspace is only partly searched
const MAX_NOTES = 200;

interface NoteSidePanelProps {
	workspacePath: string;
	current: NoteRef;
	notes: NoteRef[];
	// The note as it is being edited, so the outline and links follow the typing
	text: string;
	onOpenNote: (path: string) => void;
	onGoToLine: (line: number) => void;
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
	return (
		<section className="space-y-1.5">
			<h3 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
				{icon}
				{title}
			</h3>
			{children}
		</section>
	);
}

export default function NoteSidePanel({ workspacePath, current, notes, text, onOpenNote, onGoToLine }: NoteSidePanelProps) {
	const headings = useMemo(() => extractHeadings(text), [text]);
	const links = useMemo(() => extractLinks(text), [text]);
	const [backlinks, setBacklinks] = useState<NoteRef[]>([]);

	// What other notes say is read from disk when the note or the list of notes changes, not on every keystroke
	const noteKey = notes.map((n) => n.path).join("|");
	useEffect(() => {
		let live = true;
		void Promise.all(
			notes.slice(0, MAX_NOTES).map(async (note) => ({
				note,
				text: await readWorkspaceFile(workspacePath, note.path.replace(/^\/+/, "")).catch(() => ""),
			})),
		).then((all) => {
			if (live) setBacklinks(findBacklinks(current, all));
		});
		return () => {
			live = false;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [workspacePath, noteKey, current.path]);

	const empty = (message: string) => <p className="text-xs text-muted-foreground">{message}</p>;
	const rowClass = "flex w-full cursor-pointer items-center gap-1 truncate px-1.5 py-1 text-left text-xs hover:bg-muted";

	return (
		<aside aria-label="Outline and links" className="w-64 shrink-0 space-y-5 overflow-y-auto border-l p-3">
			<Section icon={<ListTree className="size-3" />} title="Outline">
				{headings.length === 0
					? empty("Headings you write with # appear here.")
					: headings.map((h) => (
							<button
								key={`${h.line}-${h.text}`}
								type="button"
								onClick={() => onGoToLine(h.line)}
								className={rowClass}
								style={{ paddingLeft: `${(h.level - 1) * 12 + 6}px` }}
							>
								<span className="truncate">{h.text}</span>
							</button>
						))}
			</Section>

			<Section icon={<Link2 className="size-3" />} title="Links in this note">
				{links.length === 0
					? empty("Write [[Note name]] to link to another note. Ctrl+click a link to open it.")
					: links.map((target) => {
							const note = resolveLink(target, notes);
							return note ? (
								<button key={target} type="button" onClick={() => onOpenNote(note.path)} className={rowClass}>
									<ArrowUpRight className="size-3 shrink-0 text-info" />
									<span className="truncate">{target}</span>
								</button>
							) : (
								<p key={target} className="truncate px-1.5 py-1 text-xs text-muted-foreground">
									{target} <span className="text-xs">(no such note)</span>
								</p>
							);
						})}
			</Section>

			<Section icon={<ArrowUpRight className="size-3 rotate-180" />} title="Linked from">
				{backlinks.length === 0
					? empty("No other note links here yet.")
					: backlinks.map((note) => (
							<button key={note.path} type="button" onClick={() => onOpenNote(note.path)} className={rowClass}>
								<span className="truncate">{note.name}</span>
							</button>
						))}
			</Section>
		</aside>
	);
}
