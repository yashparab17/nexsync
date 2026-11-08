// Slides: slide decks (.pptx) of the workspace, opened as live shared decks. The slides are drawn by the backend from the deck's pieces;
// the frames over them select, move and resize shapes, and everyone with the deck open sees the changes as they are made.

import { useEffect, useState } from "react";

import Loading from "@/components/Loading";
import { EmptyState, Page } from "@/components/layout/Page";
import { Notice } from "@/components/ui/notice";
import { OfficeFileDialogs, OfficeFileList } from "@/features/office/shared/OfficeFileList";
import { type OfficeKind, useOfficeFiles } from "@/features/office/shared/useOfficeFiles";
import SlideWorkspace from "@/features/office/slides/components/SlideWorkspace";
import { useCollabDoc } from "@/hooks/useCollabDoc";
import { useMyName } from "@/hooks/useMyName";
import { useReportLine } from "@/hooks/usePresence";
import { isDeck } from "@/lib/editor/languages";
import { deckNew, deckOpen, deckSave } from "@/features/office/lib/api";
import { errorText } from "@/lib/utils";
import { LAYOUT } from "@/lib/workspaceLayout";
import { useWorkspace } from "@/store/workspace/WorkspaceContext";

const KIND: OfficeKind = {
	page: "slides",
	folder: LAYOUT.slides,
	matches: isDeck,
	ext: "pptx",
	noun: "deck",
	plural: "decks",
	accept: ".pptx,.pptm,.potx,.ppsx",
	empty: "No decks yet. Make one, or add a .pptx file.",
	reject: "Choose a .pptx file.",
};

export default function SlidesPage() {
	const { workspace } = useWorkspace();
	const workspacePath = workspace?.path ?? "";
	const author = useMyName();
	// `?open=path#L3` opens a deck at slide 3 (someone presenting is followed this way)
	const [wanted, setWanted] = useState<number | null>(null);
	const files = useOfficeFiles({
		kind: KIND,
		make: async (path) => {
			const fresh = await deckNew();
			await deckSave(workspacePath, path, fresh.parts.base, fresh.parts.slides);
		},
		openParam: (v) => {
			const [path, line] = v.split("#L");
			setWanted(Number(line) || null);
			return path;
		},
	});
	const { selected, notice, isViewer } = files;

	const [opened, setOpened] = useState<{ base: string; slides: string[]; notes: string[] } | { error: string } | null>(null);
	const [line, setLine] = useState<number | undefined>();
	useReportLine(line);

	useEffect(() => {
		setOpened(null);
		if (!workspacePath || !selected) return;
		let live = true;
		deckOpen(workspacePath, selected)
			.then((o) => live && setOpened({ base: o.parts.base, slides: o.parts.slides, notes: o.notes }))
			.catch((err) => live && setOpened({ error: errorText(err, "That file could not be opened.") }));
		return () => {
			live = false;
		};
	}, [workspacePath, selected]);

	const collab = useCollabDoc(workspacePath, opened && "base" in opened ? (selected ?? undefined) : undefined);

	return (
		<Page>
			<div className="flex min-h-0 flex-1">
				<OfficeFileList kind={KIND} files={files} />

				<main className="flex min-h-0 min-w-0 flex-1 flex-col">
					{notice && (
						<Notice tone={notice.ok ? "success" : "error"} className="px-3 py-2">
							{notice.text}
						</Notice>
					)}
					{!selected ? (
						<EmptyState art="slides" title="Slides">
							Open a PowerPoint deck as a presentation everyone in the workspace edits together: move and resize shapes, type into them, add pictures, notes and transitions, and present to the team. Copies save as .pptx.
						</EmptyState>
					) : !opened ? (
						<Loading className="h-48" />
					) : "error" in opened ? (
						<Notice className="m-6 max-w-md p-3">{opened.error}</Notice>
					) : collab ? (
						<SlideWorkspace key={selected} collab={collab} opened={opened} name={selected.split("/").pop() ?? ""} rel={selected} workspacePath={workspacePath} readOnly={isViewer} author={author} startAt={wanted} onSlide={setLine} />
					) : (
						<Loading className="h-48" />
					)}
				</main>
			</div>

			<OfficeFileDialogs kind={KIND} files={files} />
		</Page>
	);
}
