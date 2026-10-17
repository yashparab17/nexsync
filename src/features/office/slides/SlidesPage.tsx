import { useNewParam } from "@/hooks/useNewParam";
import { pushRecent } from "@/lib/recentFiles";
// Slides: slide decks (.pptx) of the workspace, opened as live shared decks. The slides are drawn by the backend from the deck's pieces;
// the frames over them select, move and resize shapes, and everyone with the deck open sees the changes as they are made.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { FilePlus, FileText, Upload } from "@/components/animate-icons";
import CollapsiblePane from "@/components/layout/CollapsiblePane";
import PresenceDots from "@/components/elements/PresenceDots";
import { EmptyState, Page } from "@/components/layout/Page";
import SlideWorkspace from "@/features/office/slides/components/SlideWorkspace";
import Toolbar, { ToolbarSearch, ToolbarTitle } from "@/components/layout/Toolbar";
import Loading from "@/components/Loading";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogHeading } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { readFileBase64 } from "@/features/assets/lib/uploadScale";
import { useCollabDoc } from "@/hooks/useCollabDoc";
import { useErrorLog } from "@/hooks/useErrorLog";
import { useOpenParam } from "@/hooks/useOpenParam";
import { useReportItem, useReportLine } from "@/hooks/usePresence";
import { LAYOUT, isIn, placeIn } from "@/lib/workspaceLayout";
import { isDeck } from "@/lib/editor/languages";
import { deckNew, deckOpen, deckSave, searchWorkspaceFiles, writeWorkspaceBinaryFile } from "@/lib/tauri";
import { cn, errorText } from "@/lib/utils";
import { safeUploadName, validateFileName } from "@/lib/validation";
import { useIsViewer, useP2P } from "@/store/p2p/P2PContext";
import { useWorkspace } from "@/store/workspace/WorkspaceContext";

interface Deck {
	name: string;
	rel: string;
}
const strip = (p: string) => p.replace(/^\/+/, "");

export default function SlidesPage() {
	const { workspace } = useWorkspace();
	const logError = useErrorLog();
	const isViewer = useIsViewer();
	const { selfName, viewersAt, lastSyncedFile } = useP2P();
	const workspacePath = workspace?.path ?? "";
	const author = selfName ?? "Someone";

	const [decks, setDecks] = useState<Deck[] | null>(null);
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState<string | null>(null);
	const [opened, setOpened] = useState<{ base: string; slides: string[]; notes: string[] } | { error: string } | null>(null);
	const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
	const [creating, setCreating] = useState(false);
	const [newName, setNewName] = useState("");
	const fileInput = useRef<HTMLInputElement>(null);

	const load = useCallback(() => {
		if (!workspacePath) return;
		searchWorkspaceFiles(workspacePath)
			.then((all) => setDecks((all ?? []).filter((f) => isDeck(f.name) && isIn(f.path, LAYOUT.slides)).map((f) => ({ name: f.name, rel: strip(f.path) })).sort((a, b) => a.name.localeCompare(b.name))))
			.catch((err) => {
				logError(err, { source: "slides", workspace: workspacePath });
				setDecks([]);
			});
	}, [workspacePath, logError]);
	useEffect(load, [load, lastSyncedFile]);

	// `?open=path#L3` opens a deck at slide 3 (someone presenting is followed this way)
	const [wanted, setWanted] = useState<number | null>(null);
	useOpenParam((v) => {
		const [path, line] = v.split("#L");
		setSelected(strip(path));
		setWanted(Number(line) || null);
	}, !!workspacePath);
	useReportItem(selected);
	useNewParam(() => setCreating(true), !!workspacePath && !isViewer);
	useEffect(() => {
		if (workspacePath && selected) pushRecent(workspacePath, selected);
	}, [workspacePath, selected]);
	const [line, setLine] = useState<number | undefined>();
	useReportLine(line);

	useEffect(() => {
		setOpened(null);
		setNotice(null);
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
	const flash = (ok: boolean, text: string) => setNotice({ ok, text });

	const create = async () => {
		const name = newName.trim();
		if (!name || validateFileName(name) || !workspacePath) return;
		const rel = placeIn(LAYOUT.slides, `${name}.pptx`);
		if (decks?.some((d) => d.rel.toLowerCase() === rel.toLowerCase())) return flash(false, "A deck with that name exists.");
		try {
			const fresh = await deckNew();
			await deckSave(workspacePath, `${workspacePath.replace(/[\\/]+$/, "")}/${rel}`, fresh.parts.base, fresh.parts.slides);
			setCreating(false);
			setNewName("");
			load();
			setSelected(rel);
		} catch (err) {
			flash(false, errorText(err, "The deck could not be made."));
		}
	};

	const addFile = async (file: File) => {
		try {
			const name = safeUploadName(file.name);
			if (!isDeck(name)) return flash(false, "Choose a .pptx file.");
			await writeWorkspaceBinaryFile(workspacePath, placeIn(LAYOUT.slides, name), await readFileBase64(file));
			load();
			setSelected(placeIn(LAYOUT.slides, name));
		} catch (err) {
			flash(false, errorText(err, "The file could not be added."));
		}
	};

	const shownDecks = useMemo(() => (decks ?? []).filter((d) => d.name.toLowerCase().includes(query.trim().toLowerCase())), [decks, query]);

	return (
		<Page>
			<Toolbar>
				<ToolbarTitle name="Slides" meta={decks ? String(decks.length) : undefined} />
				<ToolbarSearch label="Search decks" value={query} onChange={setQuery} placeholder="Search" className="w-48" />
				<span className="flex-1" />
				{!isViewer && (
					<>
						<input
							ref={fileInput}
							type="file"
							accept=".pptx,.pptm,.potx,.ppsx"
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
							New Deck
						</Button>
					</>
				)}
			</Toolbar>

			<div className="flex min-h-0 flex-1">
				<CollapsiblePane id="slides.list" defaultWidth={224} label="the list of decks">
					<nav aria-label="Decks" className="w-56 shrink-0 space-y-0.5 overflow-y-auto border-r bg-panel p-2">
					{decks === null ? null : shownDecks.length === 0 ? (
						<p className="p-3 text-sm text-muted-foreground">{decks.length === 0 ? "No decks yet. Make one, or add a .pptx file." : "No deck matches."}</p>
					) : (
						shownDecks.map((d) => (
							<button key={d.rel} type="button" aria-current={d.rel === selected} onClick={() => setSelected(d.rel)} className={cn("flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted", d.rel === selected && "bg-muted")}>
								<FileText className="size-4 shrink-0 text-muted-foreground" />
								<span className="min-w-0 flex-1 truncate">{d.name}</span>
								<PresenceDots names={viewersAt("slides", d.rel)} />
							</button>
						))
					)}
				</nav>
				</CollapsiblePane>

				<main className="flex min-h-0 min-w-0 flex-1 flex-col">
					{notice && (
						<p role={notice.ok ? "status" : "alert"} className={cn("px-3 py-2 text-sm", notice.ok ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive")}>
							{notice.text}
						</p>
					)}
					{!selected ? (
						<EmptyState art="slides" title="Slides">
							Open a PowerPoint deck as a presentation everyone in the workspace edits together: move and resize shapes, type into them, add pictures, notes and transitions, and present to the team. Copies save as .pptx.
						</EmptyState>
					) : !opened ? (
						<Loading className="h-48" />
					) : "error" in opened ? (
						<p role="alert" className="m-6 max-w-md bg-destructive/10 p-3 text-sm text-destructive">
							{opened.error}
						</p>
					) : collab ? (
						<SlideWorkspace key={selected} collab={collab} opened={opened} name={selected.split("/").pop() ?? ""} rel={selected} workspacePath={workspacePath} readOnly={isViewer} author={author} startAt={wanted} onSlide={setLine} />
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
						<DialogHeading icon={<FilePlus className="size-6" />} title="New Deck" />
						<Input aria-label="Deck name" autoFocus required value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Quarterly review" aria-invalid={!!(newName && validateFileName(newName))} />
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
