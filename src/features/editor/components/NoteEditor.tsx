import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import { Check, Download, Eye, FileText, GitBranch, History, MessageSquareDiff, PanelRight, Type, Users } from "@/components/animate-icons";

import CodeEditor from "@/features/editor/components/CodeEditor";
import RichTextEditor from "@/features/editor/components/RichTextEditor";
import MarkdownPreview from "@/components/elements/MarkdownPreview";
import CollapsiblePane from "@/components/layout/CollapsiblePane";
import NoteSidePanel from "@/features/editor/components/NoteSidePanel";
import BranchesDialog from "@/components/dialogs/workspace/BranchesDialog";
import SuggestEditDialog from "@/components/dialogs/workspace/SuggestEditDialog";
import { buildThreads, docChannel, threadsMarkdown } from "@/features/chat/lib/entries";
import { plainPreview } from "@/features/chat/lib/preview";
import { useChat } from "@/store/chat/ChatContext";
import { ExpiryControl } from "@/components/elements/ExpiryBadge";
import { useFileComments } from "@/features/editor/components/useFileComments";
import { useCanComment } from "@/store/p2p/P2PContext";
import { proposalMarks } from "@/lib/editor/proposalsView";
import FileHistoryDialog from "@/components/dialogs/workspace/FileHistoryDialog";
import { Button } from "@/components/ui/button";
import { useAutoSnapshot } from "@/hooks/useAutoSnapshot";
import { useCollabDoc } from "@/hooks/useCollabDoc";
import { useSeededText } from "@/hooks/useSeededText";
import { branchDocId, listBranches } from "@/lib/branches";
import { minimalChange } from "@/lib/editor/format";
import { isMarkdownFile } from "@/lib/editor/languages";
import { exportNote, type NoteFormat } from "@/lib/export";
import { markdownStats, textStats } from "@/features/notes/lib/text";
import { noteTitle, resolveLink, type NoteRef } from "@/features/notes/lib/links";
import { wikiLinks } from "@/lib/editor/wikiLinks";
import { useP2P } from "@/store/p2p/P2PContext";
import Loading from "@/components/Loading";
import { useMyName } from "@/hooks/useMyName";

interface NoteEditorProps {
	fileName: string;
	// The note as it is on disk
	initialContent: string;
	onSave: (content: string) => Promise<void>;
	onClose?: () => void;
	readOnly?: boolean;
	// Workspace-relative path, which is also the id of the shared document
	workspacePath?: string;
	docId?: string;
	// The other notes, so [[links]] can open them and the side panel can list backlinks
	notes?: NoteRef[];
	onOpenNote?: (path: string) => void;
	// Told the whole text on every change, so a board can show the note as it is being written
	onTextChange?: (text: string) => void;
}

// The end of a note is not part of what a person wrote, so it does not decide whether there are unsaved changes
const sameNote = (a: string, b: string) => a.replace(/\s+$/, "") === b.replace(/\s+$/, "");

// Editor for one note. Markdown files (.md) are edited as Markdown source; text files (.txt) get a rich-text
// editor and are saved as plain text.
export default function NoteEditor({ fileName, initialContent, onSave, readOnly = false, workspacePath, docId, notes, onOpenNote, onTextChange }: NoteEditorProps) {
	const isMarkdown = isMarkdownFile(fileName);
	const { peers, shareNamedVersion } = useP2P();
	const userName = useMyName();
	// The note's own document is always open (it holds the list of branches); a branch being worked on is a second one.
	// Branches are for Markdown notes, which are shared text.
	const mainCollab = useCollabDoc(workspacePath, docId);
	const [branch, setBranch] = useState<{ id: string; name: string } | null>(null);
	const [branchesOpen, setBranchesOpen] = useState(false);
	// The note as it reads, with its pictures and embedded notes, beside the text
	const [previewOpen, setPreviewOpen] = useState(false);
	const branchCollab = useCollabDoc(workspacePath, branch ? branchDocId(branch.id) : undefined);
	const collab = branch ? branchCollab : mainCollab;
	const openBranch = (id: string | null) => {
		setBranch(id && mainCollab ? { id, name: listBranches(mainCollab.doc).find((b) => b.id === id)?.name ?? "branch" } : null);
	};

	// The note on disk; it moves forward each time it is saved
	const [saved, setSaved] = useState(() => initialContent.replace(/\r\n/g, "\n"));
	const [content, setContent] = useState(saved);
	// Read through a ref so a new callback each render does not restart anything
	const textChangeRef = useRef(onTextChange);
	textChangeRef.current = onTextChange;
	useEffect(() => {
		textChangeRef.current?.(content);
	}, [content]);
	const [saving, setSaving] = useState(false);
	const [historyOpen, setHistoryOpen] = useState(false);
	const [exportMenu, setExportMenu] = useState(false);
	const [exportNotice, setExportNotice] = useState<{ ok: boolean; text: string } | null>(null);
	const viewRef = useRef<EditorView | null>(null);
	const replaceRef = useRef<((text: string) => void) | null>(null);
	const onRichReady = useCallback((replace: (text: string) => void) => {
		replaceRef.current = replace;
	}, []);

	const [panelOpen, setPanelOpen] = useState(() => window.innerWidth >= 1280);
	const current = useMemo<NoteRef>(() => ({ path: `/${docId ?? fileName}`, name: fileName }), [docId, fileName]);
	// Ctrl or Cmd+click on a [[link]] opens that note; read through a ref so the editor is not rebuilt
	const openLinkRef = useRef<(target: string) => void>(() => {});
	openLinkRef.current = (target) => {
		const note = resolveLink(target, notes ?? []);
		if (note) onOpenNote?.(note.path);
	};
	const linkExtensions = useMemo(() => wikiLinks((target) => openLinkRef.current(target)), []);
	// Open suggestions show inside the editor for whoever has the note open; the button writes a new one
	const [suggesting, setSuggesting] = useState<{ from: number; to: number } | null>(null);
	// Comments on the note: highlighted in the text, listed in a panel beside it (Markdown notes only; they are shared text)
	const canComment = useCanComment();
	const chat = useChat();
	const comments = useFileComments({ path: docId ?? fileName, doc: isMarkdown && mainCollab && !branch ? mainCollab.doc : null, canComment });
	const markdownExtensions = useMemo(
		() => [linkExtensions, comments.extension, ...(collab ? [proposalMarks(collab.doc, collab.doc.getText("content"), userName, !readOnly)] : [])],
		[linkExtensions, comments.extension, collab, userName, readOnly],
	);
	const goToLine = (line: number) => {
		const view = viewRef.current;
		if (!view) return;
		const at = view.state.doc.line(Math.min(Math.max(line, 1), view.state.doc.lines));
		view.dispatch({ selection: { anchor: at.from }, scrollIntoView: true });
		view.focus();
	};

	// Markdown: wait for the stored text, fill an empty document from the file, then build the editor with it
	const seeded = useSeededText(isMarkdown ? collab : null, saved);
	useEffect(() => {
		if (seeded) setContent(seeded.text);
	}, [seeded]);

	// Work on a branch is not the note, so it is never unsaved changes to it
	const dirty = !sameNote(content, saved) && !branch;
	const stats = useMemo(() => (isMarkdown ? markdownStats(content) : textStats(content)), [isMarkdown, content]);

	const save = useCallback(async () => {
		if (saving || readOnly || !dirty || branch) return;
		// A live Markdown document is the truth; the rich editor reports plain text as it changes
		const body = isMarkdown && collab ? collab.doc.getText("content").toString() : content;
		// The comments go at the end, so an exported note keeps what was said about it
		const text = body + threadsMarkdown(buildThreads(chat.entries, docChannel(docId ?? fileName)), (c) => plainPreview(c, chat.people, 100_000));
		try {
			setSaving(true);
			await onSave(text);
			setSaved(text);
			setContent(text);
		} catch (err) {
			console.error("Save failed:", err);
		} finally {
			setSaving(false);
		}
	}, [saving, readOnly, dirty, branch, isMarkdown, collab, content, onSave]);

	// Work that was never saved with the Save button still ends up in the file history
	useAutoSnapshot(workspacePath, docId, content, !readOnly && !branch);

	// An older version goes into the live editor, so collaborators see it and it can be undone
	const restoreText = (text: string) => {
		if (isMarkdown) {
			const view = viewRef.current;
			const change = view && minimalChange(view.state.doc.toString(), text);
			if (view && change) view.dispatch({ changes: change });
		} else replaceRef.current?.(text);
	};

	const runExport = async (format: NoteFormat) => {
		setExportMenu(false);
		if (!workspacePath) return;
		const text = isMarkdown && collab ? collab.doc.getText("content").toString() : content;
		try {
			const dest = await exportNote(workspacePath, fileName, text, format);
			if (dest) setExportNotice({ ok: true, text: `Exported to ${dest}` });
		} catch (err) {
			setExportNotice({ ok: false, text: err instanceof Error ? err.message : String(err) });
		}
	};
	useEffect(() => {
		if (!exportNotice) return;
		const timer = setTimeout(() => setExportNotice(null), 6000);
		return () => clearTimeout(timer);
	}, [exportNotice]);

	// Notes save themselves a moment after the last keystroke, and when they are closed, so there is no Save button to forget
	const saveRef = useRef(save);
	saveRef.current = save;
	useEffect(() => {
		if (!dirty || readOnly || branch) return;
		const timer = setTimeout(() => void saveRef.current(), 1200);
		return () => clearTimeout(timer);
	}, [dirty, content, readOnly, branch]);
	useEffect(() => () => void saveRef.current(), []);

	// Ctrl+S / Cmd+S saves now
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if ((e.ctrlKey || e.metaKey) && e.key === "s") {
				e.preventDefault();
				void save();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [save]);

	return (
		<div className="flex h-full w-full flex-col bg-background">
			<div className="flex h-10 shrink-0 items-center justify-between gap-3 border-b px-3">
				<div className="flex min-w-0 items-center gap-2 text-sm">
					{isMarkdown ? <FileText className="size-4 shrink-0 text-info" /> : <Type className="size-4 shrink-0 text-warning" />}
					<span className="truncate font-medium">{noteTitle(fileName)}</span>
					{isMarkdown && <span className="shrink-0 font-mono text-xs text-muted-foreground">.md</span>}
					{dirty || saving ? (
						<span className="flex shrink-0 items-center gap-2 text-xs text-warning" role="status">
							<span className="size-1.5 animate-pulse bg-warning motion-reduce:animate-none" />
							{saving ? "Saving…" : "Unsaved"}
						</span>
					) : (
						<span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground" role="status">
							<Check className="size-3 text-success" />
							Saved
						</span>
					)}
				</div>

				<div className="flex items-center gap-1">
					{collab && peers.length > 0 && (
						<span className="mr-1 flex items-center gap-1 text-xs font-medium text-success">
							<Users className="size-3" />
							Live
						</span>
					)}
					<div className="mr-2 hidden items-center gap-2 font-mono text-xs text-muted-foreground sm:flex" role="group" aria-label="Note statistics">
						<span>
							{stats.lines} {stats.lines === 1 ? "line" : "lines"}
						</span>
						<span>•</span>
						<span>
							{stats.words} {stats.words === 1 ? "word" : "words"}
						</span>
						<span>•</span>
						<span>
							{stats.chars} {stats.chars === 1 ? "char" : "chars"}
						</span>
					</div>
					{workspacePath && docId && (
						<>
							{isMarkdown && collab && !readOnly && !branch && (
								<Button
									variant="ghost"
									size="icon-xs"
									aria-label="Suggest edit"
									onPress={() => {
										const { from, to } = viewRef.current?.state.selection.main ?? { from: 0, to: 0 };
										setSuggesting({ from, to });
									}}
								>
									<MessageSquareDiff className="size-4" />
								</Button>
							)}
							{isMarkdown && mainCollab && (
								<Button variant="ghost" size="icon-xs" aria-label="Branches" onPress={() => setBranchesOpen(true)}>
									<GitBranch className="size-4" />
								</Button>
							)}
							{isMarkdown && (
								<Button variant="ghost" size="icon-xs" aria-label={previewOpen ? "Hide the preview" : "Show the preview"} aria-pressed={previewOpen} onPress={() => setPreviewOpen((open) => !open)}>
									<Eye className="size-4" />
								</Button>
							)}
							<ExpiryControl entity="file" id={docId} name={fileName} />
							<Button variant="ghost" size="icon-xs" aria-label="History" onPress={() => setHistoryOpen(true)}>
								<History className="size-4" />
							</Button>
							<div className="relative">
								<Button variant="ghost" size="icon-xs" aria-label="Export" onPress={() => setExportMenu((open) => !open)} aria-expanded={exportMenu}>
									<Download className="size-4" />
								</Button>
								{exportMenu && (
									<>
										<button type="button" aria-label="Close export menu" className="fixed inset-0 z-10 cursor-default" onClick={() => setExportMenu(false)} />
										<div className="absolute right-0 z-20 mt-1 w-44 border bg-popover p-1 ring-1 ring-foreground/10">
											<Button variant="ghost" size="sm" className="w-full justify-start" onPress={() => void runExport("md")}>
												Markdown (.md)
											</Button>
											<Button variant="ghost" size="sm" className="w-full justify-start" onPress={() => void runExport("pdf")}>
												PDF Document
											</Button>
										</div>
									</>
								)}
							</div>
							{notes && onOpenNote && (
								<Button variant="ghost" size="icon-xs" aria-label="Outline and links" aria-pressed={panelOpen} onPress={() => setPanelOpen((open) => !open)}>
									<PanelRight className="size-4" />
								</Button>
							)}
						</>
					)}
				</div>
			</div>

			{branch && (
				<div className="flex items-center gap-2 border-b border-primary/30 bg-primary/10 px-3 py-2 text-xs">
					<GitBranch className="size-3.5 shrink-0 text-primary" />
					<span className="min-w-0 flex-1">
						You are working on the branch <span className="font-semibold">{branch.name}</span>. {fileName} does not change until the branch is merged.
					</span>
					<Button size="sm" onPress={() => setBranchesOpen(true)}>
						Review and Merge
					</Button>
					<Button variant="ghost" size="sm" onPress={() => openBranch(null)}>
						Back to the Note
					</Button>
				</div>
			)}

			<div className="flex min-h-0 flex-1">
				<div className="relative min-h-0 min-w-0 flex-1">
				{isMarkdown && !branch && collab && seeded && comments.controls}
				{isMarkdown ? (
					!collab || !seeded ? (
						<Loading fill />
					) : (
						<CodeEditor
							key={collab.doc.guid}
							value={saved}
							fileName={fileName}
							onChange={setContent}
							readOnly={readOnly}
							collab={collab}
							userName={userName}
							minHeight="0px"
							onReady={(view) => {
								viewRef.current = view;
								comments.onReady(view);
							}}
							extraExtensions={markdownExtensions}
						/>
					)
				) : !collab ? (
					<Loading fill />
				) : (
					<RichTextEditor
						key={collab.doc.guid}
						initialText={saved}
						onChange={setContent}
						readOnly={readOnly}
						collab={collab}
						userName={userName}
						onReady={onRichReady}
					/>
				)}
				</div>
				{isMarkdown && previewOpen && (
					<div className="min-h-0 w-1/2 min-w-0 border-l bg-background">
						<MarkdownPreview text={content} notes={notes ?? []} workspacePath={workspacePath} from={docId} onOpenNote={onOpenNote ? (note) => onOpenNote(note.path) : undefined} />
					</div>
				)}
				{!branch && comments.panel}
				{panelOpen && notes && onOpenNote && workspacePath && (
					<CollapsiblePane id="note.outline" defaultWidth={256} label="the outline" side="right">
					<NoteSidePanel
						workspacePath={workspacePath}
						current={current}
						notes={notes}
						text={content}
						onOpenNote={onOpenNote}
						onGoToLine={goToLine}
					/>
					</CollapsiblePane>
				)}
			</div>

			{exportNotice && (
				<p role={exportNotice.ok ? "status" : "alert"} className={`mt-2 truncate text-xs ${exportNotice.ok ? "text-success" : "text-destructive"}`}>
					{exportNotice.text}
				</p>
			)}

			{comments.dialog}

			{suggesting && collab && <SuggestEditDialog doc={collab.doc} userName={userName} from={suggesting.from} to={suggesting.to} onClose={() => setSuggesting(null)} />}

			{branchesOpen && workspacePath && mainCollab && (
				<BranchesDialog
					workspacePath={workspacePath}
					fileName={fileName}
					doc={mainCollab.doc}
					userName={userName}
					canEdit={!readOnly}
					activeId={branch?.id ?? null}
					onOpenBranch={openBranch}
					onClose={() => setBranchesOpen(false)}
				/>
			)}

			{historyOpen && workspacePath && docId && (
				<FileHistoryDialog
					workspacePath={workspacePath}
					path={docId}
					currentText={content}
					authorName={userName}
					onNamed={(label, text) => shareNamedVersion(docId, label, text)}
					onRestoreText={readOnly ? undefined : restoreText}
					readOnly={readOnly}
					onClose={() => setHistoryOpen(false)}
				/>
			)}
		</div>
	);
}
