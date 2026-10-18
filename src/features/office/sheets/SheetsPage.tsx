import { useNewParam } from "@/hooks/useNewParam";
import { useSyncedIn } from "@/hooks/useSyncedIn";
import { pushRecent } from "@/lib/recentFiles";
// Sheets: spreadsheet files of the workspace (.xlsx and the formats it reads) opened as live shared workbooks. What people type and how
// cells look is kept in a shared document; the cells' answers are worked out by the spreadsheet engine from that text, on every device alike.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { FilePlus, FileText, Upload } from "@/components/animate-icons";
import CollapsiblePane from "@/components/layout/CollapsiblePane";
import PresenceDots from "@/components/elements/PresenceDots";
import { EmptyState, Page } from "@/components/layout/Page";
import SheetWorkspace from "@/features/office/sheets/components/SheetWorkspace";
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
import { isSpreadsheet } from "@/lib/editor/languages";
import type { SheetIn } from "@/features/office/sheets/lib/sheet";
import { searchWorkspaceFiles, sheetOpen, sheetSave, writeWorkspaceBinaryFile } from "@/lib/tauri";
import { cn, errorText } from "@/lib/utils";
import { safeUploadName, validateFileName } from "@/lib/validation";
import { useIsViewer, useP2P } from "@/store/p2p/P2PContext";
import { useWorkspace } from "@/store/workspace/WorkspaceContext";

interface Book {
	name: string;
	rel: string;
}
const strip = (p: string) => p.replace(/^\/+/, "");

export default function SheetsPage() {
	const { workspace } = useWorkspace();
	const logError = useErrorLog();
	const isViewer = useIsViewer();
	const { selfName, viewersAt } = useP2P();
	const synced = useSyncedIn(LAYOUT.sheets);
	const workspacePath = workspace?.path ?? "";
	const author = selfName ?? "Someone";

	const [books, setBooks] = useState<Book[] | null>(null);
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState<string | null>(null);
	const [opened, setOpened] = useState<{ sheets: SheetIn[]; notes: string[] } | { error: string } | null>(null);
	const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
	const [creating, setCreating] = useState(false);
	const [newName, setNewName] = useState("");
	const fileInput = useRef<HTMLInputElement>(null);

	const load = useCallback(() => {
		if (!workspacePath) return;
		searchWorkspaceFiles(workspacePath)
			.then((all) => setBooks((all ?? []).filter((f) => isSpreadsheet(f.name) && isIn(f.path, LAYOUT.sheets)).map((f) => ({ name: f.name, rel: strip(f.path) })).sort((a, b) => a.name.localeCompare(b.name))))
			.catch((err) => {
				logError(err, { source: "sheets", workspace: workspacePath });
				setBooks([]);
			});
	}, [workspacePath, logError]);
	useEffect(load, [load, synced]);

	useOpenParam((p) => setSelected(strip(p)), !!workspacePath);
	useReportItem(selected);
	useNewParam(() => setCreating(true), !!workspacePath && !isViewer);
	useEffect(() => {
		if (workspacePath && selected) pushRecent(workspacePath, selected);
	}, [workspacePath, selected]);

	// The file as the workbook gets it the first time; the shared copy takes over once there is one
	useEffect(() => {
		setOpened(null);
		setNotice(null);
		if (!workspacePath || !selected) return;
		let live = true;
		sheetOpen(workspacePath, selected)
			.then((o) => live && setOpened(o))
			.catch((err) => live && setOpened({ error: errorText(err, "That file could not be opened.") }));
		return () => {
			live = false;
		};
	}, [workspacePath, selected]);

	const collab = useCollabDoc(workspacePath, opened && "sheets" in opened ? (selected ?? undefined) : undefined);
	const flash = (ok: boolean, text: string) => setNotice({ ok, text });

	const create = async () => {
		const name = newName.trim();
		if (!name || validateFileName(name) || !workspacePath) return;
		const rel = placeIn(LAYOUT.sheets, `${name}.xlsx`);
		if (books?.some((b) => b.rel.toLowerCase() === rel.toLowerCase())) return flash(false, "A workbook with that name exists.");
		try {
			await sheetSave(workspacePath, `${workspacePath.replace(/[\\/]+$/, "")}/${rel}`, [{ name: "Sheet1", cells: {} }], "Sheet1");
			setCreating(false);
			setNewName("");
			load();
			setSelected(rel);
		} catch (err) {
			flash(false, errorText(err, "The workbook could not be made."));
		}
	};

	const addFile = async (file: File) => {
		try {
			const name = safeUploadName(file.name);
			if (!isSpreadsheet(name)) return flash(false, "Choose a spreadsheet file (.xlsx, .xls, .ods, .csv).");
			await writeWorkspaceBinaryFile(workspacePath, placeIn(LAYOUT.sheets, name), await readFileBase64(file));
			load();
			setSelected(placeIn(LAYOUT.sheets, name));
		} catch (err) {
			flash(false, errorText(err, "The file could not be added."));
		}
	};

	const shownBooks = useMemo(() => (books ?? []).filter((b) => b.name.toLowerCase().includes(query.trim().toLowerCase())), [books, query]);

	return (
		<Page>
			<Toolbar>
				<ToolbarTitle name="Sheets" meta={books ? String(books.length) : undefined} />
				<ToolbarSearch label="Search workbooks" value={query} onChange={setQuery} placeholder="Search" className="w-48" />
				<span className="flex-1" />
				{!isViewer && (
					<>
						<input
							ref={fileInput}
							type="file"
							accept=".xlsx,.xlsm,.xlsb,.xls,.ods,.csv,.tsv"
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
							New Workbook
						</Button>
					</>
				)}
			</Toolbar>

			<div className="flex min-h-0 flex-1">
				<CollapsiblePane id="sheets.list" defaultWidth={224} label="the list of workbooks">
					<nav aria-label="Workbooks" className="w-56 shrink-0 space-y-0.5 overflow-y-auto border-r bg-panel p-2">
					{books === null ? null : shownBooks.length === 0 ? (
						<p className="p-3 text-sm text-muted-foreground">{books.length === 0 ? "No workbooks yet. Make one, or add an .xlsx, .xls, .ods or .csv file." : "No workbook matches."}</p>
					) : (
						shownBooks.map((b) => (
							<button key={b.rel} type="button" aria-current={b.rel === selected} onClick={() => setSelected(b.rel)} className={cn("flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted", b.rel === selected && "bg-muted")}>
								<FileText className="size-4 shrink-0 text-muted-foreground" />
								<span className="min-w-0 flex-1 truncate">{b.name}</span>
								<PresenceDots names={viewersAt("sheets", b.rel)} />
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
						<EmptyState art="sheets" title="Sheets">
							Open a spreadsheet as a workbook everyone in the workspace edits together: type a value or a formula, and everyone sees the answers. It reads .xlsx, .xls, .ods and .csv files, keeps fonts, colours, number formats and column widths, and saves copies as .xlsx, .csv or PDF.
						</EmptyState>
					) : !opened ? (
						<Loading className="h-48" />
					) : "error" in opened ? (
						<p role="alert" className="m-6 max-w-md bg-destructive/10 p-3 text-sm text-destructive">
							{opened.error}
						</p>
					) : collab ? (
						<SheetWorkspace key={selected} collab={collab} opened={opened} name={selected.split("/").pop() ?? ""} rel={selected} workspacePath={workspacePath} author={author} readOnly={isViewer} />
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
						<DialogHeading icon={<FilePlus className="size-6" />} title="New Workbook" />
						<Input aria-label="Workbook name" autoFocus required value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Budget" aria-invalid={!!(newName && validateFileName(newName))} />
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
