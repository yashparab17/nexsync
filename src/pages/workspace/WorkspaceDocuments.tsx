// Documents: word-processor files (.docx, .odt, .rtf) of the workspace, opened as live shared documents. The file is where a document
// starts and where a copy can go; while it is open, the shared copy is the document, and everyone with it open edits it together.

import { save } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { FilePlus, FileText, Upload } from "@/components/animate-icons";
import DocumentWorkspace, { type Layout } from "@/components/documents/DocumentWorkspace";
import PresenceDots from "@/components/elements/PresenceDots";
import { EmptyState, Page } from "@/components/layout/Page";
import Toolbar, { ToolbarSearch, ToolbarTitle } from "@/components/layout/Toolbar";
import Loading from "@/components/Loading";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogHeading } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { readFileBase64 } from "@/lib/assets/uploadScale";
import { useCollabDoc } from "@/hooks/useCollabDoc";
import { useErrorLog } from "@/hooks/useErrorLog";
import { useOpenParam } from "@/hooks/useOpenParam";
import { useReportItem } from "@/hooks/usePresence";
import { isOfficeDocument } from "@/lib/editor/languages";
import { officeExport, officeImport, searchWorkspaceFiles, writeWorkspaceBinaryFile } from "@/lib/tauri";
import { cn, errorText } from "@/lib/utils";
import { safeUploadName, validateFileName } from "@/lib/validation";
import { useIsViewer, useP2P } from "@/store/p2p/P2PContext";
import { useWorkspace } from "@/store/workspace/WorkspaceContext";
import type { Imported } from "@/types/office";

interface Doc {
	name: string;
	// Workspace-relative, such as files/report.docx
	rel: string;
}

const strip = (p: string) => p.replace(/^\/+/, "");

export default function WorkspaceDocuments() {
	const { workspace } = useWorkspace();
	const logError = useErrorLog();
	const isViewer = useIsViewer();
	const { selfName, viewersAt, lastSyncedFile } = useP2P();
	const workspacePath = workspace?.path ?? "";
	const author = selfName ?? "Someone";

	const [docs, setDocs] = useState<Doc[] | null>(null);
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState<string | null>(null);
	const [state, setState] = useState<{ imported?: Imported; error?: string; password?: boolean } | null>(null);
	const [password, setPassword] = useState("");
	const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
	const [creating, setCreating] = useState(false);
	const [newName, setNewName] = useState("");
	const fileInput = useRef<HTMLInputElement>(null);

	const load = useCallback(() => {
		if (!workspacePath) return;
		searchWorkspaceFiles(workspacePath)
			.then((all) => setDocs((all ?? []).filter((f) => isOfficeDocument(f.name) && /^\/(files|notes)\//.test(f.path)).map((f) => ({ name: f.name, rel: strip(f.path) })).sort((a, b) => a.name.localeCompare(b.name))))
			.catch((err) => {
				logError(err, { source: "documents", workspace: workspacePath });
				setDocs([]);
			});
	}, [workspacePath, logError]);
	useEffect(load, [load, lastSyncedFile]);

	useOpenParam((p) => setSelected(strip(p)), !!workspacePath);
	useReportItem(selected);

	// The file as the editor gets it the first time; the shared copy takes over once there is one
	const open = useCallback(
		(pw?: string) => {
			if (!workspacePath || !selected) return;
			setState(null);
			officeImport(workspacePath, selected, pw ?? null)
				.then((a) => setState(a.imported ? { imported: a.imported } : { error: a.error ?? "That file could not be opened.", password: a.password }))
				.catch((err) => setState({ error: errorText(err, "That file could not be opened.") }));
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
			const size = await officeExport(workspacePath, dest, html, title, anonymous ? "" : author, layout);
			flash(true, `Saved a copy (${Math.max(1, Math.round(size / 1024))} KB).`);
		} catch (err) {
			flash(false, errorText(err, "The copy could not be saved."));
		}
	};

	const updateFile = async (html: string, layout: Layout, anonymous: boolean) => {
		if (!selected) return;
		try {
			await officeExport(workspacePath, `${workspacePath.replace(/[\\/]+$/, "")}/${selected}`, html, title, anonymous ? "" : author, layout);
			flash(true, "The file now matches the document.");
			load();
		} catch (err) {
			flash(false, errorText(err, "The file could not be updated."));
		}
	};

	const create = async () => {
		const name = newName.trim();
		if (!name || validateFileName(name) || !workspacePath) return;
		const rel = `files/${name}.docx`;
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

	const addFile = async (file: File) => {
		try {
			const name = safeUploadName(file.name);
			if (!isOfficeDocument(name)) return flash(false, "Choose a .docx, .doc, .odt or .rtf file.");
			await writeWorkspaceBinaryFile(workspacePath, `files/${name}`, await readFileBase64(file));
			load();
			setSelected(`files/${name}`);
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
				<nav aria-label="Documents" className="w-56 shrink-0 space-y-0.5 overflow-y-auto border-r bg-panel p-2">
					{docs === null ? null : shown.length === 0 ? (
						<p className="p-3 text-sm text-muted-foreground">{docs.length === 0 ? "No documents yet. Make one, or add a .docx, .doc, .odt or .rtf file." : "No document matches."}</p>
					) : (
						shown.map((d) => (
							<button key={d.rel} type="button" aria-current={d.rel === selected} onClick={() => setSelected(d.rel)} className={cn("flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted", d.rel === selected && "bg-muted")}>
								<FileText className="size-4 shrink-0 text-muted-foreground" />
								<span className="min-w-0 flex-1 truncate">{d.name}</span>
								<PresenceDots names={viewersAt("documents", d.rel)} />
							</button>
						))
					)}
				</nav>

				<main className="flex min-h-0 min-w-0 flex-1 flex-col">
					{!selected ? (
						<EmptyState art="notes" title="Documents">
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
							initialHtml={state.imported!.html}
							name={selected.split("/").pop() ?? ""}
							title={title}
							author={author}
							readOnly={isViewer}
							inspect={state.imported!.inspect}
							canUpdateFile={["docx", "odt", "rtf"].includes(ext)}
							onSaveCopy={saveCopy}
							onUpdateFile={updateFile}
							notice={notice}
						/>
					) : (
						<Loading className="h-48" />
					)}
				</main>
			</div>

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
