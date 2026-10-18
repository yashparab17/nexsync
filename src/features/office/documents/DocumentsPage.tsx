import { useNewParam } from "@/hooks/useNewParam";
import { useSyncedIn } from "@/hooks/useSyncedIn";
import { pushRecent } from "@/lib/recentFiles";
// Documents: word-processor files (.docx, .odt, .rtf) of the workspace, opened as live shared documents. The file is where a document
// starts and where a copy can go; while it is open, the shared copy is the document, and everyone with it open edits it together.

import { save } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { FilePlus, FileText, Pencil, Trash2, Upload } from "@/components/animate-icons";
import { useContextMenu } from "@/components/elements/ContextMenu";
import DocumentWorkspace, { type Layout } from "@/features/office/documents/components/DocumentWorkspace";
import CollapsiblePane from "@/components/layout/CollapsiblePane";
import PresenceDots from "@/components/elements/PresenceDots";
import { EmptyState, Page } from "@/components/layout/Page";
import Toolbar, { ToolbarSearch, ToolbarTitle } from "@/components/layout/Toolbar";
import Loading from "@/components/Loading";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogHeading } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { readFileBase64 } from "@/features/assets/lib/uploadScale";
import { useCollabDoc } from "@/hooks/useCollabDoc";
import { useErrorLog } from "@/hooks/useErrorLog";
import { useOpenParam } from "@/hooks/useOpenParam";
import { useReportItem } from "@/hooks/usePresence";
import { LAYOUT, isIn, placeIn } from "@/lib/workspaceLayout";
import { isOfficeDocument } from "@/lib/editor/languages";
import { deleteWorkspaceItem, officeExport, officeImport, renameWorkspaceItem, renameYjsDoc, searchWorkspaceFiles, writeWorkspaceBinaryFile } from "@/lib/tauri";
import { cn, errorText } from "@/lib/utils";
import { safeUploadName, validateFileName } from "@/lib/validation";
import { useIsViewer, useP2P } from "@/store/p2p/P2PContext";
import { useWorkspace } from "@/store/workspace/WorkspaceContext";
import type { Imported } from "@/features/office/types";
import { setFontFactors } from "@/features/office/documents/lib/fontMetrics";

interface Doc {
	name: string;
	// Workspace-relative, such as files/report.docx
	rel: string;
}

const strip = (p: string) => p.replace(/^\/+/, "");

export default function DocumentsPage() {
	const { workspace, addActivityEvent } = useWorkspace();
	const logError = useErrorLog();
	const isViewer = useIsViewer();
	const { selfName, viewersAt } = useP2P();
	const synced = useSyncedIn(LAYOUT.documents);
	const workspacePath = workspace?.path ?? "";
	const author = selfName ?? "Someone";

	const [docs, setDocs] = useState<Doc[] | null>(null);
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState<string | null>(null);
	const [opened, setState] = useState<{ rel: string; imported?: Imported; error?: string; password?: boolean } | null>(null);
	// What was opened, only while it is the file chosen: a file still opening when another is chosen never stands for that one
	const state = opened && opened.rel === selected ? opened : null;
	// The line heights of the file's fonts, before its text is drawn
	if (state?.imported) setFontFactors(state.imported.fonts);
	const [password, setPassword] = useState("");
	const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
	const [creating, setCreating] = useState(false);
	const [newName, setNewName] = useState("");
	const fileInput = useRef<HTMLInputElement>(null);
	const [renaming, setRenaming] = useState<{ doc: Doc; value: string; error: string } | null>(null);
	const [deleting, setDeleting] = useState<Doc | null>(null);
	const menu = useContextMenu();
	const startRename = (d: Doc) => setRenaming({ doc: d, value: d.name.replace(/\.[^.]+$/, ""), error: "" });

	const load = useCallback(() => {
		if (!workspacePath) return;
		searchWorkspaceFiles(workspacePath)
			.then((all) => setDocs((all ?? []).filter((f) => isOfficeDocument(f.name) && isIn(f.path, LAYOUT.documents)).map((f) => ({ name: f.name, rel: strip(f.path) })).sort((a, b) => a.name.localeCompare(b.name))))
			.catch((err) => {
				logError(err, { source: "documents", workspace: workspacePath });
				setDocs([]);
			});
	}, [workspacePath, logError]);
	useEffect(load, [load, synced]);

	useOpenParam((p) => setSelected(strip(p)), !!workspacePath);
	useReportItem(selected);
	useNewParam(() => setCreating(true), !!workspacePath && !isViewer);
	useEffect(() => {
		if (workspacePath && selected) pushRecent(workspacePath, selected);
	}, [workspacePath, selected]);

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
		setNotice(null);
		open();
	}, [open]);

	const collab = useCollabDoc(workspacePath, state?.imported ? (selected ?? undefined) : undefined);
	const title = state?.imported?.title ?? selected?.split("/").pop() ?? "";
	const ext = selected?.split(".").pop()?.toLowerCase() ?? "";
	const shown = useMemo(() => (docs ?? []).filter((d) => d.name.toLowerCase().includes(query.trim().toLowerCase())), [docs, query]);
	const flash = (ok: boolean, text: string) => setNotice({ ok, text });

	const saveCopy = async (format: string, html: string, layout: Layout, anonymous: boolean) => {
		if (!selected) return;
		try {
			const base = (selected.split("/").pop() ?? "document").replace(/\.[^.]+$/, "");
			const dest = await save({ title: "Save a copy", defaultPath: `${base}.${format}`, filters: [{ name: format.toUpperCase(), extensions: [format] }] });
			if (!dest) return;
			const size = await officeExport(workspacePath, dest, html, title, anonymous ? "" : author, layout, state?.imported?.sourceId);
			flash(true, `Saved a copy (${Math.max(1, Math.round(size / 1024))} KB).`);
		} catch (err) {
			flash(false, errorText(err, "The copy could not be saved."));
		}
	};

	const updateFile = async (html: string, layout: Layout, anonymous: boolean) => {
		if (!selected) return;
		try {
			await officeExport(workspacePath, `${workspacePath.replace(/[\\/]+$/, "")}/${selected}`, html, title, anonymous ? "" : author, layout, state?.imported?.sourceId);
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

	const create = async () => {
		const name = newName.trim();
		if (!name || validateFileName(name) || !workspacePath) return;
		const rel = placeIn(LAYOUT.documents, `${name}.docx`);
		if (docs?.some((d) => d.rel.toLowerCase() === rel.toLowerCase())) return flash(false, "A document with that name exists.");
		try {
			await officeExport(workspacePath, `${workspacePath.replace(/[\\/]+$/, "")}/${rel}`, "<p></p>", name, author);
			setCreating(false);
			setNewName("");
			load();
			setSelected(rel);
		} catch (err) {
			flash(false, errorText(err, "The document could not be made."));
		}
	};

	const handleDelete = async () => {
		if (isViewer || !workspacePath || !deleting) return;
		const gone = deleting;
		setDeleting(null);
		try {
			await deleteWorkspaceItem(workspacePath, gone.rel);
			addActivityEvent("Deleted document", `Deleted document ${gone.name}`, undefined, "file");
			if (selected === gone.rel) setSelected(null);
			load();
		} catch (err) {
			flash(false, errorText(err, "The document could not be deleted."));
		}
	};

	const handleRename = async () => {
		if (!renaming || !workspacePath) return;
		const { doc } = renaming;
		const dot = doc.name.lastIndexOf(".");
		let name = renaming.value.trim().replace(/[\\/]/g, "-");
		const problem = name ? validateFileName(name) : "Name is required.";
		if (problem) return setRenaming({ ...renaming, error: problem });
		if (!isOfficeDocument(name)) name += dot > 0 ? doc.name.slice(dot) : ".docx";
		if (name === doc.name) return setRenaming(null);
		const moved = `${doc.rel.slice(0, doc.rel.lastIndexOf("/") + 1)}${name}`;
		if (docs?.some((d) => d.rel.toLowerCase() === moved.toLowerCase())) return setRenaming({ ...renaming, error: "A document with that name exists." });
		try {
			await renameWorkspaceItem(workspacePath, doc.rel, name);
			// The shared copy goes with the file, so what people have written in it is not left behind
			await renameYjsDoc(workspacePath, doc.rel, moved).catch(() => {});
			if (selected === doc.rel) setSelected(moved);
			setRenaming(null);
			load();
		} catch (err) {
			setRenaming({ ...renaming, error: errorText(err, "The document could not be renamed.") });
		}
	};

	const docMenu = (e: React.MouseEvent, d: Doc) =>
		menu.open(e, [
			{ label: "Open", icon: <FileText className="size-4" />, shortcut: "Enter", onSelect: () => setSelected(d.rel) },
			"separator",
			{ label: "Rename…", icon: <Pencil className="size-4" />, shortcut: "F2", disabled: isViewer, onSelect: () => startRename(d) },
			{ label: "Delete…", icon: <Trash2 className="size-4" />, shortcut: "Del", danger: true, disabled: isViewer, onSelect: () => setDeleting(d) },
		]);

	const addFile = async (file: File) => {
		try {
			const name = safeUploadName(file.name);
			if (!isOfficeDocument(name)) return flash(false, "Choose a .docx, .doc, .odt or .rtf file.");
			await writeWorkspaceBinaryFile(workspacePath, placeIn(LAYOUT.documents, name), await readFileBase64(file));
			load();
			setSelected(placeIn(LAYOUT.documents, name));
		} catch (err) {
			flash(false, errorText(err, "The file could not be added."));
		}
	};

	return (
		<Page>
			<Toolbar>
				<ToolbarTitle name="Documents" meta={docs ? String(docs.length) : undefined} />
				<ToolbarSearch label="Search documents" value={query} onChange={setQuery} placeholder="Search" className="w-48" />
				<span className="flex-1" />
				{!isViewer && (
					<>
						<input
							ref={fileInput}
							type="file"
							accept=".docx,.docm,.dotx,.dotm,.doc,.dot,.odt,.rtf"
							className="hidden"
							onChange={(e) => {
								const f = e.target.files?.[0];
								e.target.value = "";
								if (f) void addFile(f);
							}}
						/>
						<Button variant="outline" size="sm" onPress={() => fileInput.current?.click()}>
							<Upload className="size-4" />
							Add a File
						</Button>
						<Button size="sm" onPress={() => setCreating(true)}>
							<FilePlus className="size-4" />
							New Document
						</Button>
					</>
				)}
			</Toolbar>

			<div className="flex min-h-0 flex-1">
				<CollapsiblePane id="documents.list" defaultWidth={224} label="the list of documents">
					<nav aria-label="Documents" className="w-56 shrink-0 space-y-0.5 overflow-y-auto border-r bg-panel p-2">
					{docs === null ? null : shown.length === 0 ? (
						<p className="p-3 text-sm text-muted-foreground">{docs.length === 0 ? "No documents yet. Make one, or add a .docx, .doc, .odt or .rtf file." : "No document matches."}</p>
					) : (
						shown.map((d) => (
							<div key={d.rel} className={cn("group flex min-w-0 items-center hover:bg-muted", d.rel === selected && "bg-muted")}>
								<button
									type="button"
									aria-current={d.rel === selected}
									onClick={() => setSelected(d.rel)}
									onContextMenu={(e) => docMenu(e, d)}
									onKeyDown={(e) => {
										if (isViewer) return;
										if (e.key === "F2") startRename(d);
										else if (e.key === "Delete") setDeleting(d);
									}}
									className="flex min-w-0 flex-1 items-center gap-2 py-2 pl-3 text-left text-sm outline-none focus-visible:bg-muted"
								>
									<FileText className="size-4 shrink-0 text-muted-foreground" />
									<span className="min-w-0 flex-1 truncate">{d.name}</span>
									<PresenceDots names={viewersAt("documents", d.rel)} />
								</button>
								{!isViewer && (
									<button type="button" aria-label={`Delete ${d.name}`} title="Delete" onClick={() => setDeleting(d)} className="mr-1 flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-0 outline-none group-hover:opacity-100 hover:text-destructive focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring">
										<Trash2 className="size-3.5" />
									</button>
								)}
							</div>
						))
					)}
				</nav>
				</CollapsiblePane>

				<main className="flex min-h-0 min-w-0 flex-1 flex-col">
					{!selected ? (
						<EmptyState art="documents" title="Documents">
							Open a Word, OpenDocument or Rich Text file as a document that everyone in the workspace edits together, or start a new one. Copies go out as .docx, .odt, .rtf, Markdown, a web page or plain text.
						</EmptyState>
					) : !state ? (
						<Loading className="h-48" />
					) : state.error ? (
						<div className="m-6 max-w-md space-y-3 text-sm">
							<p role="alert" className="bg-destructive/10 p-3 text-destructive">
								{state.error}
							</p>
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
							key={selected}
							collab={collab}
							initialBlocks={state.imported!.blocks}
							lists={state.imported!.lists}
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

			{menu.menu}
			{renaming && (
				<Dialog isOpen onOpenChange={(o) => !o && setRenaming(null)} className="max-w-md">
					<form
						className="space-y-4"
						onSubmit={(e) => {
							e.preventDefault();
							void handleRename();
						}}
					>
						<DialogHeading icon={<Pencil className="size-6" />} title="Rename Document" description={<>{renaming.doc.name}</>} />
						<Input aria-label="New name" autoFocus value={renaming.value} onChange={(e) => setRenaming({ ...renaming, value: e.target.value, error: "" })} aria-invalid={!!(validateFileName(renaming.value) ?? renaming.error)} />
						{(validateFileName(renaming.value) ?? renaming.error) && <p role="alert" className="text-xs text-destructive">{validateFileName(renaming.value) ?? renaming.error}</p>}
						<DialogFooter className="mt-2">
							<Button type="button" variant="outline" onPress={() => setRenaming(null)}>
								Cancel
							</Button>
							<Button type="submit" isDisabled={!renaming.value.trim() || !!validateFileName(renaming.value)}>
								Rename
							</Button>
						</DialogFooter>
					</form>
				</Dialog>
			)}
			{deleting && (
				<Dialog isOpen onOpenChange={(o) => !o && setDeleting(null)}>
					<div className="space-y-4">
						<DialogHeading icon={<Trash2 className="size-6" />} tone="danger" title="Delete Document" description={<>Move <span className="font-semibold text-foreground">{deleting.name}</span> to the Trash? You can restore it from there.</>} />
						<DialogFooter className="mt-2">
							<Button variant="outline" onPress={() => setDeleting(null)}>
								Cancel
							</Button>
							<Button variant="destructive" onPress={() => void handleDelete()}>
								Delete
							</Button>
						</DialogFooter>
					</div>
				</Dialog>
			)}
			{creating && (
				<Dialog isOpen onOpenChange={(o) => !o && setCreating(false)} className="max-w-md">
					<form
						className="space-y-4"
						onSubmit={(e) => {
							e.preventDefault();
							void create();
						}}
					>
						<DialogHeading icon={<FilePlus className="size-6" />} title="New Document" />
						<Input aria-label="Document name" autoFocus required value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Project brief" aria-invalid={!!(newName && validateFileName(newName))} />
						{newName && validateFileName(newName) && <p role="alert" className="text-xs text-destructive">{validateFileName(newName)}</p>}
						<DialogFooter className="mt-2">
							<Button type="button" variant="outline" onPress={() => setCreating(false)}>
								Cancel
							</Button>
							<Button type="submit" isDisabled={!newName.trim() || !!validateFileName(newName)}>
								Create
							</Button>
						</DialogFooter>
					</form>
				</Dialog>
			)}
		</Page>
	);
}
