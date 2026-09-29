import { useCallback, useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { openSearchPanel } from "@codemirror/search";
import { EditorView } from "@codemirror/view";
import { AlertTriangle, Check, Loader2, Save, Search, Sparkles } from "lucide-react";

import CodeEditor from "./CodeEditor";
import { Button } from "@/components/ui/button";
import { useCollabDoc } from "@/hooks/useCollabDoc";
import { useSeededText } from "@/hooks/useSeededText";
import { useErrorLog } from "@/hooks/useErrorLog";
import { colorForName } from "@/lib/collabColor";
import {
	blameLines,
	blameRanges,
	contributions,
	trackAuthor,
	type AuthorInfo,
	type BlameRange,
	type Contribution,
} from "@/lib/editor/blame";
import { canFormat, formatCode, minimalChange } from "@/lib/editor/format";
import type { LoadedLanguage } from "@/lib/editor/languages";
import { countSyntaxErrors, errorRanges } from "@/lib/editor/syntax";
import { readWorkspaceFile, writeWorkspaceFile } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useP2P } from "@/store/p2p/P2PContext";
import { useWorkspace } from "@/store/workspace/WorkspaceContext";

interface CodeTabProps {
	// Workspace-relative path of the file, which is also the id of its shared document
	path: string;
	// Only the visible tab takes keyboard shortcuts; the others stay mounted so their state is kept
	active: boolean;
	readOnly: boolean;
	showBlame: boolean;
	onDirtyChange: (path: string, dirty: boolean) => void;
}

// One open file in the Editor tab: a live shared document with format, find, save, problem markers and blame
export default function CodeTab({ path, active, readOnly, showBlame, onDirtyChange }: CodeTabProps) {
	const { workspace, metadata, addActivityEvent } = useWorkspace();
	const { selfName } = useP2P();
	const logError = useErrorLog();
	const workspacePath = workspace?.path ?? "";
	const fileName = path.split("/").pop() ?? path;
	const userName = selfName ?? metadata?.members.members.find((m) => m.role === "Owner")?.name ?? "You";

	const collab = useCollabDoc(workspacePath, path);
	const viewRef = useRef<EditorView | null>(null);
	const [language, setLanguage] = useState<LoadedLanguage | null>(null);
	const [saved, setSaved] = useState<string | null>(null);
	const [content, setContent] = useState("");
	const [saving, setSaving] = useState(false);
	const [problems, setProblems] = useState(0);
	const [notice, setNotice] = useState<string | null>(null);
	const [mergeWarning, setMergeWarning] = useState<number | null>(null);
	const [blame, setBlame] = useState<{ ranges: BlameRange[]; people: Contribution[] } | null>(null);

	// Read the file from disk; the shared document is seeded from it the first time it is opened
	useEffect(() => {
		let current = true;
		setSaved(null);
		readWorkspaceFile(workspacePath, path)
			.then((raw) => {
				if (!current) return;
				// The editor and the shared text only agree on positions with LF line endings, so files are saved with LF.
				const text = raw.replace(/\r\n/g, "\n");
				setSaved(text);
				setContent(text);
			})
			.catch((err) => logError(err, { source: "editor", workspace: workspacePath }));
		return () => {
			current = false;
		};
	}, [workspacePath, path, logError]);

	// Wait for the stored text, fill an empty document from the file, then build the editor with that text in it
	const seeded = useSeededText(collab, saved);
	useEffect(() => {
		// What the shared text holds may differ from disk, so unsaved changes show as such.
		if (seeded) setContent(seeded.text);
	}, [seeded]);

	const dirty = saved !== null && content !== saved;
	useEffect(() => onDirtyChange(path, dirty), [path, dirty, onDirtyChange]);

	const refreshProblems = useCallback(() => {
		if (viewRef.current) setProblems(errorRanges(viewRef.current.state, 99).length);
	}, []);
	useEffect(() => {
		// The parse tree is ready shortly after the language loads
		const timer = setTimeout(refreshProblems, 300);
		return () => clearTimeout(timer);
	}, [language, refreshProblems]);

	const save = useCallback(async () => {
		if (saving || readOnly || saved === null) return;
		const text = collab ? collab.doc.getText("content").toString() : content;
		try {
			setSaving(true);
			await writeWorkspaceFile(workspacePath, path, text);
			setSaved(text);
			setContent(text);
			addActivityEvent("Saved file", `Edited ${path}`, `/${path}`, "file");
		} catch (err) {
			logError(err, { source: "editor", workspace: workspacePath });
		} finally {
			setSaving(false);
		}
	}, [saving, readOnly, saved, collab, content, workspacePath, path, addActivityEvent, logError]);

	// Ctrl+S saves the visible tab
	useEffect(() => {
		if (!active) return;
		const onKey = (e: KeyboardEvent) => {
			if ((e.ctrlKey || e.metaKey) && e.key === "s") {
				e.preventDefault();
				void save();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [active, save]);

	const format = async () => {
		const view = viewRef.current;
		if (!view) return;
		setNotice(null);
		try {
			const before = view.state.doc.toString();
			const change = minimalChange(before, await formatCode(before, fileName));
			if (change) view.dispatch({ changes: change });
		} catch (err) {
			const message = err instanceof Error ? err.message.split("\n")[0] : String(err);
			setNotice(`Could not format: ${message}`);
		}
	};

	const jumpToLine = (line: number) => {
		const view = viewRef.current;
		if (!view) return;
		const pos = view.state.doc.line(Math.min(Math.max(line, 1), view.state.doc.lines)).from;
		view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "center" }) });
		view.focus();
	};

	// Record who this session belongs to once they edit, so blame can name them
	useEffect(() => (collab ? trackAuthor(collab.doc, userName) : undefined), [collab, userName]);

	// A merge of two valid edits can still leave broken code, so compare the syntax errors before and after each remote change
	useEffect(() => {
		if (!collab || !language?.support) return;
		const support = language.support;
		const ytext = collab.doc.getText("content");
		let previous = ytext.toString();
		const observer = (_event: Y.YTextEvent, tr: Y.Transaction) => {
			const text = ytext.toString();
			if (!tr.local) {
				const before = countSyntaxErrors(previous, support);
				const after = countSyntaxErrors(text, support);
				if (before !== null && after !== null && after > before) setMergeWarning(after - before);
			} else if (countSyntaxErrors(text, support) === 0) {
				setMergeWarning(null);
			}
			previous = text;
			refreshProblems();
		};
		ytext.observe(observer);
		return () => ytext.unobserve(observer);
	}, [collab, language, refreshProblems]);

	// Blame and contributions come from the shared document, so they are the same on every device
	useEffect(() => {
		if (!collab || !showBlame) return;
		const ytext = collab.doc.getText("content");
		const authors = collab.doc.getMap<AuthorInfo>("authors");
		let timer: ReturnType<typeof setTimeout>;
		const refresh = () => {
			clearTimeout(timer);
			timer = setTimeout(
				() => setBlame({ ranges: blameRanges(blameLines(ytext, authors)), people: contributions(ytext, authors) }),
				250,
			);
		};
		refresh();
		ytext.observe(refresh);
		authors.observe(refresh);
		return () => {
			clearTimeout(timer);
			ytext.unobserve(refresh);
			authors.unobserve(refresh);
		};
	}, [collab, showBlame]);

	return (
		<div className={cn("flex h-full min-h-0 flex-col", !active && "hidden")}>
			<div className="flex flex-wrap items-center gap-2 border-b px-3 py-1.5 text-xs">
				<span className="font-medium">{language?.name ?? "…"}</span>
				{problems > 0 && (
					<span className="flex items-center gap-1 bg-destructive/10 px-1.5 py-0.5 text-destructive">
						<AlertTriangle className="size-3" />
						{problems} problem{problems > 1 ? "s" : ""}
					</span>
				)}
				{notice && <span className="truncate text-destructive">{notice}</span>}
				<div className="ml-auto flex items-center gap-1">
					<Button variant="ghost" size="xs" onPress={() => viewRef.current && (openSearchPanel(viewRef.current), viewRef.current.focus())}>
						<Search className="size-3.5" />
						Find
					</Button>
					{!readOnly && canFormat(fileName) && (
						<Button variant="ghost" size="xs" onPress={() => void format()}>
							<Sparkles className="size-3.5" />
							Format
						</Button>
					)}
					{!readOnly && (
						<Button size="xs" onPress={() => void save()} isDisabled={saving || !dirty}>
							{saving ? <Loader2 className="size-3.5 animate-spin" /> : dirty ? <Save className="size-3.5" /> : <Check className="size-3.5" />}
							{saving ? "Saving…" : dirty ? "Save" : "Saved"}
						</Button>
					)}
				</div>
			</div>

			{mergeWarning !== null && (
				<div className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-400">
					<AlertTriangle className="size-3.5 shrink-0" />
					<span className="min-w-0 flex-1">
						A collaborator&apos;s edit merged with yours and added {mergeWarning} syntax error{mergeWarning > 1 ? "s" : ""}.
						Each version was fine alone, so check where they overlap.
					</span>
					<Button
						variant="ghost"
						size="xs"
						onPress={() => {
							const first = viewRef.current && errorRanges(viewRef.current.state, 1)[0];
							if (first && viewRef.current) jumpToLine(viewRef.current.state.doc.lineAt(first.from).number);
						}}
					>
						Show first
					</Button>
					<Button variant="ghost" size="xs" onPress={() => setMergeWarning(null)}>
						Dismiss
					</Button>
				</div>
			)}

			<div className="flex min-h-0 flex-1">
				<div className="min-w-0 flex-1">
					{saved === null || !collab || !seeded ? (
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
							onReady={(view) => (viewRef.current = view)}
							onLanguage={setLanguage}
						/>
					)}
				</div>

				{showBlame && (
					<aside className="w-64 shrink-0 space-y-4 overflow-y-auto border-l p-3 text-xs">
						{!blame || blame.people.length === 0 ? (
							<p className="text-muted-foreground">Nothing to show yet. Blame appears once the file has content.</p>
						) : (
							<>
								<section className="space-y-2">
									<h3 className="font-semibold uppercase tracking-widest text-muted-foreground">Contributions</h3>
									{blame.people.map((person) => (
										<div key={person.author} className="space-y-1">
											<div className="flex justify-between gap-2">
												<span className="truncate font-medium">{person.author}</span>
												<span className="shrink-0 text-muted-foreground">
													{person.percent}% · {person.lines} line{person.lines === 1 ? "" : "s"}
												</span>
											</div>
											<div className="h-1 bg-muted">
												<div className="h-full" style={{ width: `${person.percent}%`, background: colorForName(person.author) }} />
											</div>
											{person.lastEdit && (
												<p className="text-[10px] text-muted-foreground">Last edit {new Date(person.lastEdit).toLocaleString()}</p>
											)}
										</div>
									))}
								</section>
								<section className="space-y-1">
									<h3 className="font-semibold uppercase tracking-widest text-muted-foreground">Blame</h3>
									{blame.ranges.map((range) => (
										<button
											key={`${range.from}-${range.author}`}
											type="button"
											onClick={() => jumpToLine(range.from)}
											className="flex w-full items-center gap-2 border-l-2 px-2 py-1 text-left hover:bg-muted/50"
											style={{ borderColor: colorForName(range.author) }}
										>
											<span className="min-w-0 flex-1 truncate">{range.author}</span>
											<span className="shrink-0 tabular-nums text-muted-foreground">
												{range.from === range.to ? range.from : `${range.from}–${range.to}`}
											</span>
										</button>
									))}
								</section>
							</>
						)}
					</aside>
				)}
			</div>
		</div>
	);
}
