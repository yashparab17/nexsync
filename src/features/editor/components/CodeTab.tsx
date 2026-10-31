import CollapsiblePane from "@/components/layout/CollapsiblePane";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import { openSearchPanel } from "@codemirror/search";
import { EditorView } from "@codemirror/view";
import { AlertTriangle, GitBranch } from "@/components/animate-icons";

import CodeEditor, { type CursorInfo } from "@/features/editor/components/CodeEditor";
import type { CodeTabHandle, CodeTabStatus } from "@/features/editor/components/codeTabTypes";
import type { VimCommand } from "@/lib/editor/vimSetup";
import FileHistoryDialog from "@/components/dialogs/workspace/FileHistoryDialog";
import { Button } from "@/components/ui/button";
import { useAutoSnapshot } from "@/hooks/useAutoSnapshot";
import BranchesDialog from "@/components/dialogs/workspace/BranchesDialog";
import SuggestEditDialog from "@/components/dialogs/workspace/SuggestEditDialog";
import { useChat } from "@/store/chat/ChatContext";
import { useFileComments } from "@/features/editor/components/useFileComments";
import { useCanComment } from "@/store/p2p/P2PContext";
import { proposalMarks } from "@/lib/editor/proposalsView";
import { coverageGutter, useCoverage } from "@/features/projects/lib/coverage";
import { listenToLsp, lspTarget } from "@/features/projects/lib/lsp";
import { lspExtension } from "@/lib/editor/lspExtension";
import type { LspStatus } from "@/features/projects/types";
import { useCollabDoc } from "@/hooks/useCollabDoc";
import { useSeededText } from "@/hooks/useSeededText";
import { useErrorLog } from "@/hooks/useErrorLog";
import { colorOf } from "@/lib/collabColor";
import {
	blameLines,
	blameRanges,
	contributions,
	trackAuthor,
	type AuthorInfo,
	type BlameRange,
	type Contribution,
} from "@/lib/editor/blame";
import { branchDocId, listBranches } from "@/lib/branches";
import { canFormat, formatCode, minimalChange } from "@/lib/editor/format";
import type { LoadedLanguage } from "@/lib/editor/languages";
import { hunksFromDelta, suggestRepair, type Hunk, type Suggestion } from "@/lib/editor/mergeRepair";
import { countSyntaxErrors, errorRanges } from "@/lib/editor/syntax";
import { canTypeCheck, firstNewError, loadTypeScript, typeErrors } from "@/lib/editor/typecheck";
import { lspEnable, lspStatus, readWorkspaceFile, writeWorkspaceFile } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useP2P } from "@/store/p2p/P2PContext";
import { useWorkspace } from "@/store/workspace/WorkspaceContext";
import Loading from "@/components/Loading";
import { useMyName } from "@/hooks/useMyName";

interface CodeTabProps {
	// Workspace-relative path of the file, which is also the id of its shared document
	path: string;
	// Only the visible tab takes keyboard shortcuts; the others stay mounted so their state is kept
	active: boolean;
	readOnly: boolean;
	showBlame: boolean;
	onDirtyChange: (path: string, dirty: boolean) => void;
	// What the page shows in its tab, toolbar and status line
	onStatus?: (path: string, status: CodeTabStatus) => void;
	onCursor?: (path: string, info: CursorInfo) => void;
	onText?: (path: string, text: string) => void;
	onVimMode?: (mode: string) => void;
	onVimCommand?: (command: VimCommand) => void;
	// Opens a place in another file of the workspace (go to definition); the path is the workspace's
	onOpenAt?: (path: string, line: number) => void;
}

// One open file in the Editor tab: a live shared document with format, find, save, problem markers and blame. The page
// drives it through the handle and reads its state from onStatus, so one toolbar and one status line serve every file.
const CodeTab = forwardRef<CodeTabHandle, CodeTabProps>(function CodeTab({ path, active, readOnly, showBlame, onDirtyChange, onStatus, onCursor, onText, onVimMode, onVimCommand, onOpenAt }, ref) {
	const { workspace, addActivityEvent } = useWorkspace();
	const { shareNamedVersion } = useP2P();
	const logError = useErrorLog();
	const workspacePath = workspace?.path ?? "";
	const fileName = path.split("/").pop() ?? path;
	const userName = useMyName();

	// The file's own document is always open (it holds the list of branches); a branch being worked on is a second one
	const mainCollab = useCollabDoc(workspacePath, path);
	// Lines the last coverage report says the tests reached or missed, as bars in the gutter
	const coverage = useCoverage(path);
	const [branch, setBranch] = useState<{ id: string; name: string } | null>(null);
	const [branchesOpen, setBranchesOpen] = useState(false);
	const branchCollab = useCollabDoc(workspacePath, branch ? branchDocId(branch.id) : undefined);
	const collab = branch ? branchCollab : mainCollab;
	const openBranch = (id: string | null) => {
		setBranch(id && mainCollab ? { id, name: listBranches(mainCollab.doc).find((b) => b.id === id)?.name ?? "branch" } : null);
		setMergeWarning(null);
		setRepair(null);
	};
	const viewRef = useRef<EditorView | null>(null);
	const [language, setLanguage] = useState<LoadedLanguage | null>(null);
	const [saved, setSaved] = useState<string | null>(null);
	const [content, setContent] = useState("");
	const [saving, setSaving] = useState(false);
	const [problemLines, setProblemLines] = useState<number[]>([]);
	const [notice, setNotice] = useState<string | null>(null);
	const [mergeWarning, setMergeWarning] = useState<number | null>(null);
	// A merge that parses but no longer type-checks: how many errors it added, where the first is, and what it says
	const [typeWarning, setTypeWarning] = useState<{ added: number; line: number; message: string } | null>(null);
	// The last remote change that added errors, and the repair found for it ("none" when no part of it can be kept)
	const lastMerge = useRef<{ before: string; merged: string; hunks: Hunk[] } | null>(null);
	const [repair, setRepair] = useState<Suggestion | "none" | null>(null);
	const [historyOpen, setHistoryOpen] = useState(false);
	// The part of the text a person is writing a suggestion for
	const [suggesting, setSuggesting] = useState<{ from: number; to: number } | null>(null);
	// Open suggestions of this file show inside the editor, for whoever has the file open
	// Comments on the file: highlighted in the text and listed in a panel beside it
	const canComment = useCanComment();
	const { removedNames } = useChat();
	const comments = useFileComments({ path, doc: mainCollab && !branch ? mainCollab.doc : null, canComment });
	const suggestionMarks = useMemo(() => [comments.extension, ...(collab ? [proposalMarks(collab.doc, collab.doc.getText("content"), userName, !readOnly)] : [])], [collab, userName, readOnly, comments.extension]);
	// Language intelligence (hover, problems, completion, go to definition) for a file of a project, once this device turned it on
	const target = lspTarget(path);
	const [lsp, setLsp] = useState<LspStatus | null>(null);
	const [lspNotice, setLspNotice] = useState<string | null>(null);
	useEffect(() => {
		listenToLsp();
		if (!target || !workspacePath) return setLsp(null);
		lspStatus(workspacePath, target.project).then(setLsp).catch(() => setLsp(null));
		// eslint-disable-next-line react-hooks/exhaustive-deps -- the project stands for the target
	}, [workspacePath, target?.project]);
	const ext = path.split(".").pop()?.toLowerCase() ?? "";
	const lspServer = lsp?.servers.find((s) => s.extensions.includes(ext)) ?? null;
	const lspOn = !!lspServer && lspServer.installed && lsp?.enabled === true;
	const lspExt = useMemo(
		() => (target && lspOn ? lspExtension({ workspacePath, project: target.project, rel: target.rel, onOpen: (rel, line) => onOpenAt?.(`projects/${target.project}/${rel}`, line), onNotice: setLspNotice }) : null),
		// eslint-disable-next-line react-hooks/exhaustive-deps -- the target is its project and file
		[workspacePath, target?.project, target?.rel, lspOn],
	);
	const extensionsWithCoverage = useMemo(() => [...(coverage ? [...suggestionMarks, coverageGutter(coverage)] : suggestionMarks), ...(lspExt ? [lspExt] : [])], [suggestionMarks, coverage, lspExt]);
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

	useEffect(() => onText?.(path, content), [path, content, onText]);

	// Work on a branch is not the file, so it is never unsaved changes to it
	const dirty = saved !== null && content !== saved && !branch;
	useEffect(() => onDirtyChange(path, dirty), [path, dirty, onDirtyChange]);

	// Work that was never saved with the Save button still ends up in the file history
	useAutoSnapshot(workspacePath, path, content, !readOnly && saved !== null && !branch);

	// An older version goes into the live editor as a small edit, so collaborators see it and it can be undone
	const restoreText = (text: string) => {
		const view = viewRef.current;
		if (!view) return;
		const change = minimalChange(view.state.doc.toString(), text);
		if (change) view.dispatch({ changes: change });
	};

	const refreshProblems = useCallback(() => {
		const view = viewRef.current;
		if (view) setProblemLines(errorRanges(view.state, 99).map((r) => view.state.doc.lineAt(r.from).number));
	}, []);
	useEffect(() => {
		// The parse tree is ready shortly after the language loads
		const timer = setTimeout(refreshProblems, 300);
		return () => clearTimeout(timer);
	}, [language, refreshProblems]);

	const save = useCallback(async () => {
		if (saving || readOnly || saved === null || branch) return;
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
	}, [saving, readOnly, saved, branch, collab, content, workspacePath, path, addActivityEvent, logError]);

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

	// Looks for a part of the collaborator's change that can be kept without the errors
	const findRepair = () => {
		const merge = lastMerge.current;
		const support = language?.support;
		if (!merge || !support) return;
		// With only a type warning showing, the repair looks for the part of their change that breaks the types
		const byTypes = mergeWarning === null && typeWarning !== null;
		setRepair(suggestRepair(merge.before, merge.hunks, { errors: (t) => (byTypes ? (typeErrors(fileName, t)?.length ?? null) : countSyntaxErrors(t, support)) }) ?? "none");
	};

	// Applying it is an ordinary edit, so it reaches everyone like any other
	const applyRepair = () => {
		const merge = lastMerge.current;
		if (!collab || !merge || !repair || repair === "none") return;
		const ytext = collab.doc.getText("content");
		if (ytext.toString() !== merge.merged) {
			setNotice("The file has changed since the merge. Check it again.");
			setRepair(null);
			return;
		}
		const change = minimalChange(merge.merged, repair.text);
		if (!change) return;
		collab.doc.transact(() => {
			if (change.to > change.from) ytext.delete(change.from, change.to - change.from);
			if (change.insert) ytext.insert(change.from, change.insert);
		});
		setRepair(null);
		setTypeWarning(null);
	};

	const jumpToLine = (line: number) => {
		const view = viewRef.current;
		if (!view) return;
		const pos = view.state.doc.line(Math.min(Math.max(line, 1), view.state.doc.lines)).from;
		view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "center" }) });
		view.focus();
	};

	const canSuggest = !readOnly && !!collab;
	useImperativeHandle(
		ref,
		() => ({
			save,
			format,
			find: () => viewRef.current && (openSearchPanel(viewRef.current), viewRef.current.focus()),
			history: () => setHistoryOpen(true),
			branches: () => mainCollab && setBranchesOpen(true),
			suggest: () => {
				if (!canSuggest) return;
				const { from, to } = viewRef.current?.state.selection.main ?? { from: 0, to: 0 };
				setSuggesting({ from, to });
			},
			goToLine: jumpToLine,
			focus: () => viewRef.current?.focus(),
		}),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[save, format, mainCollab, canSuggest],
	);

	const fileCanFormat = canFormat(fileName);
	useEffect(() => {
		onStatus?.(path, {
			language: language?.name ?? "…",
			dirty,
			saving,
			readOnly,
			branch: branch?.name ?? null,
			problemLines,
			canFormat: !readOnly && fileCanFormat,
			canSuggest,
			hasBranches: !!mainCollab,
		});
	}, [onStatus, path, language, dirty, saving, readOnly, branch, problemLines, fileCanFormat, canSuggest, mainCollab]);

	// Record who this session belongs to once they edit, so blame can name them
	useEffect(() => (collab ? trackAuthor(collab.doc, userName) : undefined), [collab, userName]);

	// A merge of two valid edits can still leave broken code, so compare the syntax errors before and after each remote change
	useEffect(() => {
		if (!collab || !language?.support) return;
		const support = language.support;
		const ytext = collab.doc.getText("content");
		let previous = ytext.toString();
		const observer = (event: Y.YTextEvent, tr: Y.Transaction) => {
			const text = ytext.toString();
			if (!tr.local) {
				const before = countSyntaxErrors(previous, support);
				const after = countSyntaxErrors(text, support);
				if (before !== null && after !== null && after > before) {
					setMergeWarning(after - before);
					lastMerge.current = { before: previous, merged: text, hunks: hunksFromDelta(event.changes.delta) };
					setRepair(null);
				}
			} else if (countSyntaxErrors(text, support) === 0) {
				setMergeWarning(null);
				setRepair(null);
			}
			previous = text;
			refreshProblems();
		};
		ytext.observe(observer);
		return () => ytext.unobserve(observer);
	}, [collab, language, refreshProblems]);

	// A merge can also leave code that parses but does not type-check; the compiler is loaded the first time it is needed
	useEffect(() => {
		if (!collab || !canTypeCheck(fileName)) return;
		const ytext = collab.doc.getText("content");
		let timer: ReturnType<typeof setTimeout> | undefined;
		let previous = ytext.toString();
		let from: string | null = null; // The text before the first change of a burst
		let hunks: Hunk[] = [];
		let live = true;
		const observer = (event: Y.YTextEvent, tr: Y.Transaction) => {
			if (tr.local) {
				previous = ytext.toString();
				return;
			}
			if (from === null) from = previous;
			previous = ytext.toString();
			hunks = hunksFromDelta(event.changes.delta);
			clearTimeout(timer);
			timer = setTimeout(async () => {
				const before = from;
				from = null;
				if (before === null) return;
				await loadTypeScript().catch(() => undefined);
				const text = ytext.toString();
				const a = typeErrors(fileName, before);
				const b = typeErrors(fileName, text);
				if (!live || !a || !b) return;
				if (b.length > a.length) {
					const first = firstNewError(a, b);
					setTypeWarning({ added: b.length - a.length, line: first?.line ?? 1, message: first?.message ?? "" });
					lastMerge.current = { before, merged: text, hunks };
					setRepair(null);
				}
			}, 700);
		};
		ytext.observe(observer);
		return () => {
			live = false;
			clearTimeout(timer);
			ytext.unobserve(observer);
		};
	}, [collab, fileName]);

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
			{notice && (
				<div role="alert" className="flex items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
					<AlertTriangle className="size-3.5 shrink-0" />
					<span className="min-w-0 flex-1 truncate">{notice}</span>
					<Button variant="ghost" size="xs" onPress={() => setNotice(null)}>
						Dismiss
					</Button>
				</div>
			)}

			{branch && (
				<div className="flex items-center gap-2 border-b border-primary/30 bg-primary/10 px-3 py-2 text-xs">
					<GitBranch className="size-3.5 shrink-0 text-primary" />
					<span className="min-w-0 flex-1">
						You are working on the branch <span className="font-semibold">{branch.name}</span>. {fileName} does not change until the branch is merged.
					</span>
					<Button size="xs" onPress={() => setBranchesOpen(true)}>
						Review and Merge
					</Button>
					<Button variant="ghost" size="xs" onPress={() => openBranch(null)}>
						Back to the File
					</Button>
				</div>
			)}

			{mergeWarning !== null && (
				<div className="flex items-center gap-2 border-b border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
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
						Show First
					</Button>
					{!readOnly && !repair && (
						<Button variant="ghost" size="xs" onPress={findRepair}>
							Suggest a Fix
						</Button>
					)}
					<Button variant="ghost" size="xs" onPress={() => { setMergeWarning(null); setRepair(null); }}>
						Dismiss
					</Button>
				</div>
			)}
			{typeWarning !== null && mergeWarning === null && (
				<div className="flex items-center gap-2 border-b border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
					<AlertTriangle className="size-3.5 shrink-0" />
					<span className="min-w-0 flex-1">
						A collaborator&apos;s edit merged with yours and the file no longer type-checks: {typeWarning.added} new error{typeWarning.added > 1 ? "s" : ""}. The first is on line {typeWarning.line}: {typeWarning.message}
					</span>
					<Button variant="ghost" size="xs" onPress={() => jumpToLine(typeWarning.line)}>
						Show First
					</Button>
					{!readOnly && !repair && (
						<Button variant="ghost" size="xs" onPress={findRepair}>
							Find the Change
						</Button>
					)}
					<Button variant="ghost" size="xs" onPress={() => { setTypeWarning(null); setRepair(null); }}>
						Dismiss
					</Button>
				</div>
			)}
			{(mergeWarning !== null || typeWarning !== null) && repair && (
				<div className="flex items-center gap-2 border-b border-warning/30 bg-warning/5 px-3 py-2 text-xs">
					{repair === "none" ? (
						<span className="min-w-0 flex-1 text-muted-foreground">No part of their change can be kept without the errors, so it needs a manual fix.</span>
					) : (
						<>
							<span className="min-w-0 flex-1">
								Keeping {repair.kept} of {repair.kept + repair.dropped} of their changes avoids the errors.
								{lastMerge.current?.hunks.map((h, i) =>
									repair.keep[i] ? null : (
										<code key={i} className="ml-1 bg-muted px-1">
											{(h.insert || "removal of " + h.remove + " characters").slice(0, 60).replace(/\s+/g, " ")}
										</code>
									),
								)}{" "}
								would be left out.
							</span>
							<Button size="xs" onPress={applyRepair}>
								Apply
							</Button>
						</>
					)}
					<Button variant="ghost" size="xs" onPress={() => setRepair(null)}>
						Close
					</Button>
				</div>
			)}

			{target && lspServer && lspServer.installed && lsp && !lsp.enabled && !readOnly && (
				<div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-3 py-2 text-xs">
					<span className="min-w-0 flex-1">
						{lspServer.label} intelligence (problems, hover, completion, go to definition) is available for this project. It starts the {lspServer.label} language server on this device, which can run code from the project, such as build scripts and plugins.
					</span>
					<Button size="xs" onPress={() => void lspEnable(workspacePath, target.project, true).then(() => lspStatus(workspacePath, target.project)).then(setLsp).catch((e) => setLspNotice(String(e?.message ?? e)))}>
						Turn On for This Project
					</Button>
				</div>
			)}
			{lspNotice && (
				<div role="status" className="flex items-center gap-2 border-b bg-muted/40 px-3 py-1.5 text-xs">
					<span className="min-w-0 flex-1 truncate">{lspNotice}</span>
					<Button variant="ghost" size="xs" onPress={() => setLspNotice(null)}>
						Dismiss
					</Button>
				</div>
			)}

			<div className="flex min-h-0 flex-1">
				<div className="relative min-w-0 flex-1">
					{saved !== null && collab && seeded && !branch && comments.controls}
					{saved === null || !collab || !seeded ? (
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
							onLanguage={setLanguage}
							extraExtensions={extensionsWithCoverage}
							onCursor={(info) => onCursor?.(path, info)}
							onVimMode={onVimMode}
							onVimCommand={onVimCommand}
						/>
					)}
				</div>

				{!branch && comments.panel}

				{showBlame && (
					<CollapsiblePane id="code.blame" defaultWidth={256} label="who wrote each line" side="right">
					<aside className="w-64 shrink-0 space-y-4 overflow-y-auto p-3 text-xs">
						{!blame || blame.people.length === 0 ? (
							<p className="text-muted-foreground">Nothing to show yet. Blame appears once the file has content.</p>
						) : (
							<>
								<section className="space-y-2">
									<h3 className="font-semibold text-muted-foreground">Contributions</h3>
									{blame.people.map((person) => (
										<div key={person.author} className="space-y-1">
											<div className="flex justify-between gap-2">
												<span className="truncate font-medium">
													{person.author}
													{removedNames.has(person.author) && <span className="ml-1 rounded-sm bg-destructive/15 px-1 font-mono text-[13px] text-destructive">Removed</span>}
												</span>
												<span className="shrink-0 text-muted-foreground">
													{person.percent}% · {person.lines} line{person.lines === 1 ? "" : "s"}
												</span>
											</div>
											<div className="h-1 bg-muted">
												<div className="h-full" style={{ width: `${person.percent}%`, background: colorOf(person.author) }} />
											</div>
											{person.lastEdit && (
												<p className="text-xs text-muted-foreground">Last edit {new Date(person.lastEdit).toLocaleString()}</p>
											)}
										</div>
									))}
								</section>
								<section className="space-y-1">
									<h3 className="font-semibold text-muted-foreground">Blame</h3>
									{blame.ranges.map((range) => (
										<button
											key={`${range.from}-${range.author}`}
											type="button"
											onClick={() => jumpToLine(range.from)}
											className="flex w-full items-center gap-2 border-l-2 px-2 py-1 text-left hover:bg-muted/50"
											style={{ borderColor: colorOf(range.author) }}
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
					</CollapsiblePane>
				)}
			</div>

			{branchesOpen && mainCollab && (
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

			{comments.dialog}

			{suggesting && collab && <SuggestEditDialog doc={collab.doc} userName={userName} from={suggesting.from} to={suggesting.to} onClose={() => setSuggesting(null)} />}

			{historyOpen && (
				<FileHistoryDialog
					workspacePath={workspacePath}
					path={path}
					currentText={content}
					authorName={userName}
					onNamed={(label, text) => shareNamedVersion(path, label, text)}
					onRestoreText={readOnly ? undefined : restoreText}
					readOnly={readOnly}
					onClose={() => setHistoryOpen(false)}
				/>
			)}
		</div>
	);
});

export default CodeTab;
