import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, FileText, Loader2, Save, Type, Users, X } from "lucide-react";

import CodeEditor from "./CodeEditor";
import RichTextEditor from "./RichTextEditor";
import { Button } from "@/components/ui/button";
import { useCollabDoc } from "@/hooks/useCollabDoc";
import { useSeededText } from "@/hooks/useSeededText";
import { isMarkdownFile } from "@/lib/editor/languages";
import { markdownStats, textStats } from "@/lib/notes/text";
import { useP2P } from "@/store/p2p/P2PContext";
import { useWorkspace } from "@/store/workspace/WorkspaceContext";

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
}

// The end of a note is not part of what a person wrote, so it does not decide whether there are unsaved changes
const sameNote = (a: string, b: string) => a.replace(/\s+$/, "") === b.replace(/\s+$/, "");

// Editor for one note. Markdown files (.md) are edited as Markdown source; text files (.txt) get a rich-text
// editor and are saved as plain text.
export default function NoteEditor({ fileName, initialContent, onSave, onClose, readOnly = false, workspacePath, docId }: NoteEditorProps) {
	const isMarkdown = isMarkdownFile(fileName);
	const { peers, selfName } = useP2P();
	const { metadata } = useWorkspace();
	const userName = selfName ?? metadata?.members.members.find((m) => m.role === "Owner")?.name ?? "You";
	const collab = useCollabDoc(workspacePath, docId);

	// The note on disk; it moves forward each time it is saved
	const [saved, setSaved] = useState(() => initialContent.replace(/\r\n/g, "\n"));
	const [content, setContent] = useState(saved);
	const [saving, setSaving] = useState(false);
	const [justSaved, setJustSaved] = useState(false);

	// Markdown: wait for the stored text, fill an empty document from the file, then build the editor with it
	const seeded = useSeededText(isMarkdown ? collab : null, saved);
	useEffect(() => {
		if (seeded) setContent(seeded.text);
	}, [seeded]);

	const dirty = !sameNote(content, saved);
	const stats = useMemo(() => (isMarkdown ? markdownStats(content) : textStats(content)), [isMarkdown, content]);

	const save = useCallback(async () => {
		if (saving || readOnly || !dirty) return;
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
	}, [saving, readOnly, dirty, isMarkdown, collab, content, onSave]);

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
			<div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b pb-3">
				<div className="flex min-w-0 items-center gap-2">
					<Button variant="ghost" size="icon-xs" onPress={onClose} aria-label="Close note">
						<X className="size-4" />
					</Button>
					{isMarkdown ? <FileText className="size-4 shrink-0 text-sky-400" /> : <Type className="size-4 shrink-0 text-amber-400" />}
					<span className="truncate text-sm font-semibold">{fileName}</span>
					<span className="hidden shrink-0 border px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground sm:inline">
						{isMarkdown ? "Markdown" : "Rich text · saved as plain text"}
					</span>
					{dirty ? (
						<span className="flex shrink-0 items-center gap-1 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-400">
							<span className="size-1.5 animate-pulse bg-amber-400" />
							Unsaved changes
						</span>
					) : (
						<span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
							<Check className="size-3 text-emerald-400" />
							Saved to disk
						</span>
					)}
				</div>

				<div className="flex items-center gap-2">
					{collab && peers.length > 0 && (
						<span className="flex items-center gap-1 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
							<Users className="size-3" />
							Live
						</span>
					)}
					<div
						className="hidden items-center gap-2 border bg-muted/20 px-2.5 py-1 font-mono text-[11px] text-muted-foreground sm:flex"
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
					{!readOnly && (
						<Button size="sm" onPress={() => void save()} isDisabled={saving || !dirty} className="gap-1.5">
							{saving ? <Loader2 className="size-3.5 animate-spin" /> : justSaved ? <Check className="size-3.5 text-emerald-400" /> : <Save className="size-3.5" />}
							{saving ? "Saving…" : justSaved ? "Saved!" : "Save"}
						</Button>
					)}
				</div>
			</div>

			<div className="min-h-0 flex-1">
				{isMarkdown ? (
					!collab || !seeded ? (
						<div className="flex h-full items-center justify-center">
							<Loader2 className="size-5 animate-spin text-muted-foreground" />
						</div>
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
						/>
					)
				) : !collab ? (
					<div className="flex h-full items-center justify-center">
						<Loader2 className="size-5 animate-spin text-muted-foreground" />
					</div>
				) : (
					<RichTextEditor
						key={collab.doc.guid}
						initialText={saved}
						onChange={setContent}
						readOnly={readOnly}
						collab={collab}
						userName={userName}
					/>
				)}
			</div>
		</div>
	);
}
