// Documents: word-processor files (.docx, .odt, .rtf) of the workspace, opened as live shared documents. The file is where a document
// starts and where a copy can go; while it is open, the shared copy is the document, and everyone with it open edits it together.

import { save } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Loading from "@/components/Loading";
import { EmptyState, Page } from "@/components/layout/Page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import DocumentWorkspace, { type Layout } from "@/features/office/documents/components/DocumentWorkspace";
import { setFontFactors } from "@/features/office/documents/lib/fontMetrics";
import { OfficeFileDialogs, OfficeFileList } from "@/features/office/shared/OfficeFileList";
import { DOC_TEMPLATES } from "@/features/office/shared/templates";
import { type OfficeKind, useOfficeFiles } from "@/features/office/shared/useOfficeFiles";
import type { Imported } from "@/features/office/types";
import { useCollabDoc } from "@/hooks/useCollabDoc";
import { useMyName } from "@/hooks/useMyName";
import { isOfficeDocument } from "@/lib/editor/languages";
import { officeExport, officeImport } from "@/features/office/lib/api";
import { errorText, formatBytes } from "@/lib/utils";
import { LAYOUT } from "@/lib/workspaceLayout";
import { useCanComment } from "@/store/p2p/P2PContext";
import { useWorkspace } from "@/store/workspace/WorkspaceContext";

const KIND: OfficeKind = {
	page: "documents",
	folder: LAYOUT.documents,
	matches: isOfficeDocument,
	ext: "docx",
	noun: "document",
	plural: "documents",
	accept: ".docx,.docm,.dotx,.dotm,.doc,.dot,.odt,.rtf",
	empty: "No documents yet. Make one, or add a .docx, .doc, .odt or .rtf file.",
	reject: "Choose a .docx, .doc, .odt or .rtf file.",
};

export default function DocumentsPage() {
	const { workspace } = useWorkspace();
	const canComment = useCanComment();
	const workspacePath = workspace?.path ?? "";
	const author = useMyName();
	const files = useOfficeFiles({
		kind: KIND,
		manage: true,
		make: (path, name, template) => officeExport(workspacePath, path, (DOC_TEMPLATES.find((t) => t.id === template) ?? DOC_TEMPLATES[0]).html, name, author),
	});
	const { selected, notice, isViewer, flash, load } = files;

	const [opened, setState] = useState<{ rel: string; imported?: Imported; error?: string; password?: boolean } | null>(null);
	// What was opened, only while it is the file chosen: a file still opening when another is chosen never stands for that one
	const state = opened && opened.rel === selected ? opened : null;
	// The line heights of the file's fonts, before its text is drawn
	if (state?.imported) setFontFactors(state.imported.fonts);
	const [password, setPassword] = useState("");

	// The file as the editor gets it the first time; the shared copy takes over once there is one
	const open = useCallback(
		(pw?: string) => {
			if (!workspacePath || !selected) return;
			setState(null);
			const rel = selected;
			officeImport(workspacePath, rel, pw ?? null)
				.then((a) => setState(a.imported ? { rel, imported: a.imported } : { rel, error: a.error ?? "That file could not be opened.", password: a.password }))
				.catch((err) => setState({ rel, error: errorText(err, "That file could not be opened.") }));
		},
		[workspacePath, selected],
	);
	useEffect(() => {
		setPassword("");
		open();
	}, [open]);

	const collab = useCollabDoc(workspacePath, state?.imported ? (selected ?? undefined) : undefined);
	const title = state?.imported?.title ?? selected?.split("/").pop() ?? "";
	const ext = selected?.split(".").pop()?.toLowerCase() ?? "";

	const saveCopy = async (format: string, html: string, layout: Layout, anonymous: boolean) => {
		if (!selected) return;
		try {
			const base = (selected.split("/").pop() ?? "document").replace(/\.[^.]+$/, "");
			const dest = await save({ title: "Save a copy", defaultPath: `${base}.${format}`, filters: [{ name: format.toUpperCase(), extensions: [format] }] });
			if (!dest) return;
			const size = await officeExport(workspacePath, dest, html, title, anonymous ? "" : author, layout, state?.imported?.sourceId, format === "docx" && ext !== "doc" ? password : null);
			flash(true, `Saved a copy (${formatBytes(size)}).`);
		} catch (err) {
			flash(false, errorText(err, "The copy could not be saved."));
		}
	};

	const updateFile = async (html: string, layout: Layout, anonymous: boolean) => {
		if (!selected) return;
		try {
			await officeExport(workspacePath, `${workspacePath.replace(/[\\/]+$/, "")}/${selected}`, html, title, anonymous ? "" : author, layout, state?.imported?.sourceId, ext === "docx" ? password : null);
			flash(true, "The file now matches the document.");
			load();
		} catch (err) {
			flash(false, errorText(err, "The file could not be updated."));
		}
	};

	// The file read again, for putting it back in place of the shared copy
	const reloadFile = async () => {
		if (!selected) return null;
		const rel = selected;
		try {
			const a = await officeImport(workspacePath, rel, password || null);
			if (!a.imported) {
				flash(false, a.error ?? "The file could not be read.");
				return null;
			}
			setState({ rel, imported: a.imported });
			flash(true, "The document now holds the file as it is.");
			return a.imported;
		} catch (err) {
			flash(false, errorText(err, "The file could not be read."));
			return null;
		}
	};

	// The editor is given handlers that stay the same, so it is not drawn again each time this page is (they call the latest of these)
	const latest = useRef({ saveCopy, updateFile, reloadFile });
	latest.current = { saveCopy, updateFile, reloadFile };
	const handlers = useMemo(
		() => ({
			saveCopy: (...a: Parameters<typeof saveCopy>) => latest.current.saveCopy(...a),
			updateFile: (...a: Parameters<typeof updateFile>) => latest.current.updateFile(...a),
			reloadFile: () => latest.current.reloadFile(),
		}),
		[],
	);

	return (
		<Page>
			<div className="flex min-h-0 flex-1">
				<OfficeFileList kind={KIND} files={files} />

				<main className="flex min-h-0 min-w-0 flex-1 flex-col">
					{!selected ? (
						<EmptyState art="documents" title="Documents">
							Open a Word, OpenDocument or Rich Text file as a document that everyone in the workspace edits together, or start a new one. Copies go out as .docx, .odt, .rtf, Markdown, a web page or plain text.
						</EmptyState>
					) : !state ? (
						<Loading className="h-48" />
					) : state.error ? (
						<div className="m-6 max-w-md space-y-3 text-sm">
							<Notice className="p-3">{state.error}</Notice>
							{state.password && (
								<form
									className="flex gap-2"
									onSubmit={(e) => {
										e.preventDefault();
										open(password);
									}}
								>
									<Input type="password" autoComplete="off" aria-label="Password" value={password} onChange={(e) => setPassword(e.target.value)} className="flex-1" />
									<Button type="submit" isDisabled={!password}>
										Open
									</Button>
								</form>
							)}
						</div>
					) : collab ? (
						<DocumentWorkspace
							canComment={canComment}
							key={selected}
							history={{ workspacePath, rel: selected, others: (files.list ?? []).filter((d) => d.rel !== selected) }}
							collab={collab}
							initialBlocks={state.imported!.blocks}
							lists={state.imported!.lists}
							styles={state.imported!.styles}
							notes={state.imported!.notes}
							name={selected.split("/").pop() ?? ""}
							title={title}
							author={author}
							readOnly={isViewer}
							inspect={state.imported!.inspect}
							fileLayout={state.imported!.layout}
							sourceId={state.imported!.sourceId}
							canUpdateFile={["docx", "odt", "rtf"].includes(ext)}
							onSaveCopy={handlers.saveCopy}
							onUpdateFile={handlers.updateFile}
							onReload={handlers.reloadFile}
							notice={notice}
						/>
					) : (
						<Loading className="h-48" />
					)}
				</main>
			</div>

			<OfficeFileDialogs kind={KIND} files={files} templates={DOC_TEMPLATES} />
		</Page>
	);
}
