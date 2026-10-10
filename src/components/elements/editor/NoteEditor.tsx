import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import { Download, FileText, GitBranch, History, Loader2, MessageSquareDiff, PanelRight, Save, Type, Users, X } from "lucide-react";
import { Check } from "@/components/animate-icons";

import CodeEditor from "./CodeEditor";
import RichTextEditor from "./RichTextEditor";
import NoteSidePanel from "./NoteSidePanel";
import BranchesDialog from "@/components/dialogs/workspace/BranchesDialog";
import SuggestEditDialog from "@/components/dialogs/workspace/SuggestEditDialog";
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
import { markdownStats, textStats } from "@/lib/notes/text";
import { resolveLink, type NoteRef } from "@/lib/notes/links";
import { wikiLinks } from "@/lib/editor/wikiLinks";
import { useP2P } from "@/store/p2p/P2PContext";
import { useWorkspace } from "@/store/workspace/WorkspaceContext";
import Loading from "@/components/Loading";

interface NoteEditorProps {
	fileName: string;
	// The note as it is on disk
	initialContent: string;
	onSave: (content: string) => Promise<void>;
	onClose: () => void;
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
export default function NoteEditor({ fileName, initialContent, onSave, onClose, readOnly = false, workspacePath, docId, notes, onOpenNote, onTextChange }: NoteEditorProps) {
	const isMarkdown = isMarkdownFile(fileName);
	const { peers, selfName, shareNamedVersion } = useP2P();
	const { metadata } = useWorkspace();
	const userName = selfName ?? metadata?.members.members.find((m) => m.role === "Owner")?.name ?? "You";
	// The note's own document is always open (it holds the list of branches); a branch being worked on is a second one.
	// Branches are for Markdown notes, which are shared text.
	const mainCollab = useCollabDoc(workspacePath, docId);
	const [branch, setBranch] = useState<{ id: string; name: string } | null>(null);
	const [branchesOpen, setBranchesOpen] = useState(false);
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
	const [justSaved, setJustSaved] = useState(false);
	const [historyOpen, setHistoryOpen] = useState(false);
	const [exportMenu, setExportMenu] = useState(false);
	const [exportNotice, setExportNotice] = useState<{ ok: boolean; text: string } | null>(null);
	const viewRef = useRef<EditorView | null>(null);
	const replaceRef = useRef<((text: string) => void) | null>(null);
	const onRichReady = useCallback((replace: (text: string) => void) => {
		replaceRef.current = replace;
	}, []);

	const [panelOpen, setPanelOpen] = useState(false);
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
	const markdownExtensions = useMemo(
		() => [linkExtensions, ...(collab ? [proposalMarks(collab.doc, collab.doc.getText("content"), userName, !readOnly)] : [])],
		[linkExtensions, collab, userName, readOnly],
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
		const text = isMarkdown && collab ? collab.doc.getText("content").toString() : content;
		try {
			setSaving(true);
			await onSave(text);
			setSaved(text);
			setContent(text);
			setJustSaved(true);
			setTimeout(() => setJustSaved(false), 2000);
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

	// Ctrl+S / Cmd+S saves
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
			<div className="flex min-h-11 flex-wrap items-center justify-between gap-3 border-b px-3 py-1.5">
				<div className="flex min-w-0 items-center gap-2">
					<Button variant="ghost" size="icon-xs" onPress={onClose} aria-label="Close note">
						<X className="size-4" />
					</Button>
					{isMarkdown ? <FileText className="size-4 shrink-0 text-info" /> : <Type className="size-4 shrink-0 text-warning" />}
					<span className="truncate text-sm font-semibold">{fileName}</span>
					<span className="hidden shrink-0 border px-1.5 py-0.5 text-xs text-muted-foreground sm:inline">
						{isMarkdown ? "Markdown" : "Rich text · saved as plain text"}
					</span>
					{dirty ? (
						<span className="flex shrink-0 items-center gap-1 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
							<span className="size-1.5 animate-pulse bg-warning" />
							Unsaved changes
						</span>
					) : (
						<span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
							<Check className="size-3 text-success" />
							Saved to disk
						</span>
					)}
				</div>

				<div className="flex items-center gap-2">
					{collab && peers.length > 0 && (
						<span className="flex items-center gap-1 py-0.5 text-xs font-medium text-success">
							<Users className="size-3" />
							Live
						</span>
					)}
					<div
						className="hidden items-center gap-2 border bg-muted/20 px-2.5 py-1 font-mono text-xs text-muted-foreground sm:flex"
						aria-label="Note statistics"
					>
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
							{notes && onOpenNote && (
								<Button variant="ghost" size="sm" onPress={() => setPanelOpen((open) => !open)} className="gap-1.5" aria-pressed={panelOpen}>
									<PanelRight className="size-3.5" />
									Outline
								</Button>
							)}
							{isMarkdown && collab && !readOnly && !branch && (
								<Button
									variant="ghost"
									size="sm"
									onPress={() => {
										const { from, to } = viewRef.current?.state.selection.main ?? { from: 0, to: 0 };
										setSuggesting({ from, to });
									}}
									className="gap-1.5"
								>
									<MessageSquareDiff className="size-3.5" />
									Suggest edit
								</Button>
							)}
							{isMarkdown && mainCollab && (
								<Button variant="ghost" size="sm" onPress={() => setBranchesOpen(true)} className="gap-1.5">
									<GitBranch className="size-3.5" />
									Branches
								</Button>
							)}
							<Button variant="ghost" size="sm" onPress={() => setHistoryOpen(true)} className="gap-1.5">
								<History className="size-3.5" />
								History
							</Button>
							<div className="relative">
								<Button variant="ghost" size="sm" onPress={() => setExportMenu((open) => !open)} className="gap-1.5" aria-expanded={exportMenu}>
									<Download className="size-3.5" />
									Export
								</Button>
								{exportMenu && (
									<>
										<button type="button" aria-label="Close export menu" className="fixed inset-0 z-10 cursor-default" onClick={() => setExportMenu(false)} />
										<div className="absolute right-0 z-20 mt-1 w-44 border bg-popover p-1 shadow-md">
											<Button variant="ghost" size="sm" className="w-full justify-start" onPress={() => void runExport("md")}>
												Markdown (.md)
											</Button>
											<Button variant="ghost" size="sm" className="w-full justify-start" onPress={() => void runExport("pdf")}>
												PDF document
											</Button>
										</div>
									</>
								)}
							</div>
						</>
					)}
					{!readOnly && !branch && (
						<Button size="sm" onPress={() => void save()} isDisabled={saving || !dirty} className="gap-1.5">
							{saving ? <Loader2 className="size-3.5 animate-spin" /> : justSaved ? <Check className="size-3.5 text-success" /> : <Save className="size-3.5" />}
							{saving ? "Saving…" : justSaved ? "Saved!" : "Save"}
						</Button>
					)}
				</div>
			</div>

			{branch && (
				<div className="flex items-center gap-2 border-b border-primary/30 bg-primary/10 px-3 py-1.5 text-xs">
					<GitBranch className="size-3.5 shrink-0 text-primary" />
					<span className="min-w-0 flex-1">
						You are working on the branch <span className="font-semibold">{branch.name}</span>. {fileName} does not change until the branch is merged.
					</span>
					<Button size="sm" onPress={() => setBranchesOpen(true)}>
						Review and merge
					</Button>
					<Button variant="ghost" size="sm" onPress={() => openBranch(null)}>
						Back to the note
					</Button>
				</div>
			)}

			<div className="flex min-h-0 flex-1">
				<div className="min-h-0 min-w-0 flex-1">
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
							onReady={(view) => (viewRef.current = view)}
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
				{panelOpen && notes && onOpenNote && workspacePath && (
					<NoteSidePanel
						workspacePath={workspacePath}
						current={current}
						notes={notes}
						text={content}
						onOpenNote={onOpenNote}
						onGoToLine={goToLine}
					/>
				)}
			</div>

			{exportNotice && (
				<p role={exportNotice.ok ? "status" : "alert"} className={`mt-2 truncate text-xs ${exportNotice.ok ? "text-success" : "text-destructive"}`}>
					{exportNotice.text}
				</p>
			)}

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
