import { BlockNoteView } from "@blocknote/mantine";
import { withCollaboration } from "@blocknote/core/yjs";
import { useCreateBlockNote } from "@blocknote/react";
import { Download, FilePenLine, Info, Printer, Redo2, Save, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import "@blocknote/mantine/style.css";

import DocumentInspector from "@/components/documents/DocumentInspector";
import DocumentRibbon from "@/components/documents/DocumentRibbon";
import ProofingDialog from "@/components/documents/ProofingDialog";
import { useDocumentActions } from "@/components/documents/useDocumentActions";
import Backstage from "@/components/office/Backstage";
import { OfficeFrame, ZoomBar, ACCENTS, type RibbonTab } from "@/components/office/Ribbon";
import { PeopleStack, usePeople } from "@/components/office/People";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogHeading } from "@/components/ui/dialog";
import Loading from "@/components/Loading";
import type { CollabDoc } from "@/hooks/useCollabDoc";
import { useSeedOnce } from "@/hooks/useSeedOnce";
import { colorOf } from "@/lib/collabColor";
import { countText, DEFAULT_PAGE, fontStack, NO_HEADER, pageBox, pageCount, PX_PER_PT, readHeaderFooter, readPage, type HeaderFooter, type PageSetup } from "@/lib/documentFormat";
import { headingsOf, replaceInBlocks, textOfBlocks, type BlockLike } from "@/lib/documentFind";
import { documentSchema } from "@/lib/documentSchema";
import { cn } from "@/lib/utils";
import type { OfficeInspect } from "@/types/office";

const TABS: RibbonTab[] = [
	{ id: "home", label: "Home" },
	{ id: "insert", label: "Insert" },
	{ id: "layout", label: "Layout" },
	{ id: "review", label: "Review" },
	{ id: "view", label: "View" },
];

const FORMATS = [
	{ ext: "docx", label: "Word Document (.docx)" },
	{ ext: "odt", label: "OpenDocument Text (.odt)" },
	{ ext: "rtf", label: "Rich Text Format (.rtf)" },
	{ ext: "md", label: "Markdown (.md)" },
	{ ext: "html", label: "Web Page (.html)" },
	{ ext: "txt", label: "Plain Text (.txt)" },
	{ ext: "pdf", label: "PDF (.pdf)" },
];

// What the file needs to know about the page it is written for
export interface Layout {
	width: number;
	height: number;
	landscape: boolean;
	top: number;
	right: number;
	bottom: number;
	left: number;
	columns: number;
	spacing: number;
	header: string;
	footer: string;
	pageNumbers: boolean;
}

export function layoutOf(setup: PageSetup, hf: HeaderFooter): Layout {
	const b = pageBox(setup);
	return { width: b.width, height: b.height, landscape: setup.landscape, top: b.top, right: b.right, bottom: b.bottom, left: b.left, columns: setup.columns, spacing: setup.spacing, header: hf.header, footer: hf.footer, pageNumbers: hf.pageNumbers };
}

interface Props {
	collab: CollabDoc;
	initialHtml: string;
	name: string;
	title: string;
	author: string;
	readOnly: boolean;
	inspect: OfficeInspect | null;
	// Updating the file replaces it in the workspace; only .docx, .odt and .rtf files can be
	canUpdateFile: boolean;
	// `anonymous`: leave the author's name out of the file
	onSaveCopy: (format: string, html: string, layout: Layout, anonymous: boolean) => Promise<void>;
	onUpdateFile: (html: string, layout: Layout, anonymous: boolean) => Promise<void>;
	notice?: { ok: boolean; text: string } | null;
}

// A document, laid out like a word processor: a ribbon of the things people do to text, a page on a desk with a ruler, a navigation
// pane of headings, and a status bar. The text is shared live; so are the page set-up and the header and footer.
export default function DocumentWorkspace({ collab, initialHtml, name, title, author, readOnly, inspect, canUpdateFile, onSaveCopy, onUpdateFile, notice }: Props) {
	const doc = collab.doc;
	const options = useMemo(
		() =>
			withCollaboration({
				schema: documentSchema,
				collaboration: { fragment: doc.getXmlFragment("blocknote"), user: { name: author, color: colorOf(author) }, provider: { awareness: collab.awareness } },
			}),
		[doc, collab.awareness, author],
	);
	const editor = useCreateBlockNote(options, [doc]);
	const a = useDocumentActions(editor);
	const people = usePeople(collab.awareness);

	// The editor can take text once its view exists, which is after the page has drawn it
	const [mounted, setMounted] = useState(false);
	useEffect(() => {
		const off = editor.onMount(() => setMounted(true));
		try {
			if (editor.prosemirrorView) setMounted(true);
		} catch {
			// Not mounted yet: onMount says when
		}
		return () => off?.();
	}, [editor]);

	// The file is the first text of a document nobody has opened before
	useSeedOnce(
		collab.synced && mounted,
		() => {
			// A document nobody has written in holds nothing, or the one empty paragraph the editor starts with
			const first = editor.document[0] as unknown as { type: string; content?: unknown[] } | undefined;
			const blank = doc.getXmlFragment("blocknote").length === 0 || (editor.document.length === 1 && first?.type === "paragraph" && (first.content?.length ?? 0) === 0);
			if (blank && initialHtml.trim()) editor.replaceBlocks(editor.document, editor.tryParseHTMLToBlocks(initialHtml) as never);
		},
		[collab, editor, initialHtml, mounted],
	);

	// Page set-up and the header and footer are shared, so everyone sees the same page
	const meta = doc.getMap<string>("docmeta");
	const [page, setPageState] = useState<PageSetup>(DEFAULT_PAGE);
	const [hf, setHf] = useState<HeaderFooter>(NO_HEADER);
	useEffect(() => {
		const read = () => {
			try {
				setPageState(readPage(JSON.parse(meta.get("page") ?? "null")));
				setHf(readHeaderFooter(JSON.parse(meta.get("headerFooter") ?? "null")));
			} catch {
				// A damaged value is ignored
			}
		};
		read();
		meta.observe(read);
		return () => meta.unobserve(read);
	}, [meta]);
	const setPage = (patch: Partial<PageSetup>) => meta.set("page", JSON.stringify({ ...page, ...patch }));
	const saveHf = (next: HeaderFooter) => meta.set("headerFooter", JSON.stringify(next));

	const [tab, setTab] = useState("home");
	const [anonymous, setAnonymous] = useState(false);
	const [zoom, setZoomState] = useState(100);
	const [view, setViewState] = useState({ ruler: true, navigation: false, mode: "print" as "print" | "web" | "read", spelling: true });
	const setView = (v: Partial<typeof view>) => setViewState((c) => ({ ...c, ...v }));
	const [find, setFind] = useState<{ replace: boolean; query: string; with: string; cs: boolean; note: string } | null>(null);
	const [dialog, setDialog] = useState<"headerFooter" | "counts" | "update" | "proofing" | null>(null);
	const scroller = useRef<HTMLDivElement>(null);
	const body = useRef<HTMLDivElement>(null);
	const picker = useRef<HTMLInputElement>(null);

	const box = pageBox(page);
	const widthPx = box.width * PX_PER_PT;
	const heightPx = box.height * PX_PER_PT;

	// How tall the text is, to know how many pages it fills
	const [bodyHeight, setBodyHeight] = useState(0);
	useEffect(() => {
		const el = body.current;
		if (!el) return;
		const ro = new ResizeObserver(() => setBodyHeight(el.offsetHeight));
		ro.observe(el);
		setBodyHeight(el.offsetHeight);
		return () => ro.disconnect();
	}, [collab.synced]);
	const pages = pageCount(bodyHeight, box);
	const [pageAt, setPageAt] = useState(1);
	const onScroll = () => {
		const el = scroller.current;
		if (el) setPageAt(Math.min(pages, Math.max(1, Math.floor((el.scrollTop / ((zoom / 100) * (heightPx + 24))) + 0.5) + 1)));
	};

	const setZoom = (z: number) => {
		if (z === -1) {
			const w = (scroller.current?.clientWidth ?? 900) - (view.navigation ? 0 : 48);
			setZoomState(Math.max(50, Math.min(200, Math.floor((w / widthPx) * 100))));
		} else setZoomState(z);
	};

	const words = useMemo(() => (collab.synced ? countText(textOfBlocks(editor.document as unknown as BlockLike[])) : countText("")), [editor, collab.synced, bodyHeight, a.fmt]); // eslint-disable-line react-hooks/exhaustive-deps
	const headings = useMemo(() => (view.navigation ? headingsOf(editor.document as unknown as BlockLike[]) : []), [editor, view.navigation, bodyHeight, a.fmt]); // eslint-disable-line react-hooks/exhaustive-deps

	const html = useCallback(() => editor.blocksToHTMLLossy(editor.document as never), [editor]);

	// Spelling: the browser's own checker marks the words
	useEffect(() => {
		const el = body.current?.querySelector<HTMLElement>(".bn-editor");
		el?.setAttribute("spellcheck", view.spelling ? "true" : "false");
	}, [view.spelling, collab.synced, editor]);

	const doFind = (backwards: boolean) => {
		if (!find?.query) return;
		const found = (window as unknown as { find: (q: string, cs: boolean, back: boolean, wrap: boolean) => boolean }).find(find.query, find.cs, backwards, true);
		setFind({ ...find, note: found ? "" : "No match" });
	};
	const doReplace = (all: boolean) => {
		if (!find?.query) return;
		const blocks = editor.document as unknown as BlockLike[];
		if (!all) {
			if (editor.getSelectedText().toLowerCase() === find.query.toLowerCase()) editor.insertInlineContent([find.with]);
			doFind(false);
			return;
		}
		const r = replaceInBlocks(blocks, find.query, find.with, find.cs);
		editor.transact(() => r.changed.forEach((c) => editor.updateBlock(c.id, { content: c.content } as never)));
		setFind({ ...find, note: r.count ? `Replaced ${r.count}` : "No match" });
	};

	const pickImage = () => picker.current?.click();
	const onImage = (file: File | undefined) => {
		if (!file || !file.type.startsWith("image/") || file.size > 6 * 1024 * 1024) return;
		const reader = new FileReader();
		reader.onload = () => a.insertImage(String(reader.result), file.name);
		reader.readAsDataURL(file);
	};
	const paste = async () => {
		try {
			editor.pasteText(await navigator.clipboard.readText());
		} catch {
			editor.focus();
		}
	};

	const layout = layoutOf(page, hf);
	const accent = ACCENTS.word.color;
	const columnsCss = page.columns > 1 ? { columnCount: page.columns, columnGap: "0.5in" } : {};
	const mode = view.mode;

	const file = (
		<Backstage
			accent={accent}
			onBack={() => setTab("home")}
			items={[
				{
					id: "info",
					label: "Info",
					icon: Info,
					panel: (
						<div className="max-w-2xl space-y-4">
							<h2 className="text-2xl font-light">{title}</h2>
							<p className="text-sm text-muted-foreground">{name}</p>
							<dl className="grid max-w-sm grid-cols-[1fr_auto] gap-1 text-sm">
								<dt className="text-muted-foreground">Words</dt>
								<dd className="font-mono">{words.words.toLocaleString()}</dd>
								<dt className="text-muted-foreground">Characters</dt>
								<dd className="font-mono">{words.characters.toLocaleString()}</dd>
								<dt className="text-muted-foreground">Pages (approximate)</dt>
								<dd className="font-mono">{pages}</dd>
							</dl>
							{inspect && <DocumentInspector inspect={inspect} inline />}
						</div>
					),
				},
				{
					id: "save",
					label: "Save a Copy",
					icon: Download,
					panel: (
						<div className="max-w-md space-y-2">
							<h2 className="mb-3 text-2xl font-light">Save a Copy</h2>
							<p className="mb-3 text-sm text-muted-foreground">A copy goes where you choose and does not change the file in the workspace. It is laid out for the page set on the Layout tab.</p>
							<label className="mb-2 flex items-center gap-2 text-sm">
								<input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
								Leave my name out of the file
							</label>
							{FORMATS.map((f) => (
								<button key={f.ext} type="button" onClick={() => void onSaveCopy(f.ext, html(), layout, anonymous)} className="block w-full border px-4 py-3 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
									{f.label}
								</button>
							))}
						</div>
					),
				},
				{
					id: "update",
					label: "Update the File",
					icon: FilePenLine,
					panel: (
						<div className="max-w-md space-y-3 text-sm">
							<h2 className="text-2xl font-light">Update the File</h2>
							<p>Replaces <b>{name}</b> in the workspace with what the document holds now. Everyone gets the new file.</p>
							<p className="text-muted-foreground">Named styles, footnotes, fields, comments and anything the editor does not show are not in the new file.</p>
							<Button isDisabled={!canUpdateFile || readOnly} onPress={() => setDialog("update")}>
								Replace the File…
							</Button>
							{!canUpdateFile && <p className="text-xs text-muted-foreground">Only .docx, .odt and .rtf files can be replaced.</p>}
						</div>
					),
				},
				{
					id: "print",
					label: "Print",
					icon: Printer,
					panel: (
						<div className="max-w-md space-y-3 text-sm">
							<h2 className="text-2xl font-light">Print</h2>
							<p className="text-muted-foreground">Prints the page as it is shown, with the margins, header and footer of the Layout tab.</p>
							<Button onPress={() => window.print()}>Print…</Button>
						</div>
					),
				},
				{ id: "close", label: "Close", icon: X, panel: <p className="text-sm text-muted-foreground">Choose the document tab to go back to the text. Closing is done from the list of documents.</p> },
			]}
		/>
	);

	return (
		<OfficeFrame
			accent="word"
			name={title}
			state={readOnly ? "Read-only" : "Shared"}
			tabs={TABS}
			tab={tab}
			onTab={setTab}
			quick={
				<>
					<button type="button" aria-label="Save a copy" title="Save a copy" onClick={() => setTab("file")} className="flex size-7 items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-white">
						<Save className="size-4" />
					</button>
					<button type="button" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={readOnly} onClick={a.undo} className="flex size-7 items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-white">
						<Undo2 className="size-4" />
					</button>
					<button type="button" aria-label="Redo" title="Redo (Ctrl+Y)" disabled={readOnly} onClick={a.redo} className="flex size-7 items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-white">
						<Redo2 className="size-4" />
					</button>
				</>
			}
			people={<PeopleStack people={people} />}
			ribbon={
				<DocumentRibbon
					tab={tab}
					a={a}
					fmt={a.fmt}
					readOnly={readOnly}
					page={page}
					setPage={setPage}
					view={view}
					setView={setView}
					zoom={zoom}
					setZoom={setZoom}
					openFind={(replace) => setFind({ replace, query: find?.query ?? "", with: find?.with ?? "", cs: false, note: "" })}
					openHeaderFooter={() => setDialog("headerFooter")}
					openCounts={() => setDialog("counts")}
					openProofing={() => setDialog("proofing")}
					pickImage={pickImage}
					paste={() => void paste()}
					hasHeaderFooter={!!(hf.header || hf.footer || hf.pageNumbers)}
				/>
			}
			file={file}
			status={
				<>
					<span>
						Page {pageAt} of {pages}
					</span>
					<button type="button" onClick={() => setDialog("counts")} className="outline-none hover:underline focus-visible:ring-1 focus-visible:ring-white">
						{words.words.toLocaleString()} {words.words === 1 ? "word" : "words"}
					</button>
					<span>English</span>
					<ZoomBar value={zoom} onChange={setZoom} />
				</>
			}
		>
			<input ref={picker} type="file" accept="image/*" className="hidden" onChange={(e) => { onImage(e.target.files?.[0]); e.target.value = ""; }} />
			<div className="flex h-full min-h-0 flex-col">
				{notice && (
					<p role={notice.ok ? "status" : "alert"} className={cn("px-3 py-1.5 text-sm", notice.ok ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive")}>
						{notice.text}
					</p>
				)}
				{find && (
					<div role="search" className="flex flex-wrap items-center gap-2 border-b bg-muted/50 px-3 py-1.5 text-[13px]">
						<input autoFocus aria-label="Find" placeholder="Find" value={find.query} onChange={(e) => setFind({ ...find, query: e.target.value, note: "" })} onKeyDown={(e) => e.key === "Enter" && doFind(e.shiftKey)} className="h-7 w-48 border bg-background px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring" />
						<Button variant="outline" size="xs" onPress={() => doFind(true)}>
							Previous
						</Button>
						<Button variant="outline" size="xs" onPress={() => doFind(false)}>
							Next
						</Button>
						{find.replace && (
							<>
								<input aria-label="Replace with" placeholder="Replace with" value={find.with} onChange={(e) => setFind({ ...find, with: e.target.value })} className="h-7 w-48 border bg-background px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring" />
								<Button variant="outline" size="xs" onPress={() => doReplace(false)}>
									Replace
								</Button>
								<Button variant="outline" size="xs" onPress={() => doReplace(true)}>
									Replace All
								</Button>
							</>
						)}
						<label className="flex items-center gap-1">
							<input type="checkbox" checked={find.cs} onChange={(e) => setFind({ ...find, cs: e.target.checked })} />
							Match case
						</label>
						<span className="text-muted-foreground">{find.note}</span>
						<span className="flex-1" />
						<Button variant="ghost" size="icon-xs" aria-label="Close find" onPress={() => setFind(null)}>
							<X className="size-3.5" />
						</Button>
					</div>
				)}
				<div className="flex min-h-0 flex-1">
					{view.navigation && (
						<nav aria-label="Navigation" className="w-60 shrink-0 overflow-y-auto border-r bg-background p-3 text-[13px]">
							<h2 className="mb-2 text-sm font-semibold">Navigation</h2>
							{headings.length === 0 ? (
								<p className="text-muted-foreground">Headings in the document appear here. Use the Styles on the Home tab to make one.</p>
							) : (
								<ul className="space-y-0.5">
									{headings.map((h) => (
										<li key={h.id} style={{ paddingLeft: (h.level - 1) * 12 }}>
											<button
												type="button"
												onClick={() => {
													editor.setTextCursorPosition(h.id, "start");
													body.current?.querySelector(`[data-id="${h.id}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
												}}
												className="block w-full truncate px-1.5 py-1 text-left outline-none hover:bg-muted focus-visible:bg-muted"
											>
												{h.text}
											</button>
										</li>
									))}
								</ul>
							)}
						</nav>
					)}
					<div ref={scroller} onScroll={onScroll} className="min-w-0 flex-1 overflow-auto bg-[#e1dfdd] dark:bg-neutral-900">
						{view.ruler && mode === "print" && <Ruler widthPx={widthPx} box={box} zoom={zoom} />}
						{!collab.synced ? (
							<Loading className="h-48" />
						) : (
							<div className="flex justify-center py-6" style={{ zoom: zoom / 100 }}>
								<div
									className="doc-page relative bg-white text-black shadow-md ring-1 ring-black/10"
									style={
										{
											width: mode === "print" ? widthPx : Math.min(widthPx, 920),
											minHeight: mode === "print" ? pages * heightPx : undefined,
											padding: mode === "print" ? `${box.top * PX_PER_PT}px ${box.right * PX_PER_PT}px ${box.bottom * PX_PER_PT}px ${box.left * PX_PER_PT}px` : "48px 56px",
											"--doc-font": fontStack("Calibri"),
											"--doc-ls": String(page.spacing),
										} as React.CSSProperties
									}
								>
									{mode === "print" && hf.header && (
										<div className="pointer-events-none absolute right-0 left-0 text-[10pt] text-neutral-600" style={{ top: 0.5 * 72 * PX_PER_PT, paddingInline: box.left * PX_PER_PT }}>
											{hf.header}
										</div>
									)}
									<div ref={body} style={columnsCss} className="doc-body">
										<BlockNoteView editor={editor} theme="light" editable={!readOnly && mode !== "read"} formattingToolbar={false} sideMenu={false} className="bg-transparent" />
									</div>
									{mode === "print" &&
										Array.from({ length: pages }, (_, i) => (
											<div key={i} className="pointer-events-none absolute right-0 left-0" style={{ top: (i + 1) * heightPx - 0.5 * 72 * PX_PER_PT - 14, paddingInline: box.left * PX_PER_PT }}>
												{(hf.footer || hf.pageNumbers) && (
													<div className="flex justify-between text-[10pt] text-neutral-600">
														<span>{hf.footer}</span>
														{hf.pageNumbers && <span>Page {i + 1}</span>}
													</div>
												)}
											</div>
										))}
									{mode === "print" &&
										Array.from({ length: pages - 1 }, (_, i) => (
											<div key={i} aria-hidden className="pointer-events-none absolute right-0 left-0 border-t border-dashed border-neutral-300" style={{ top: (i + 1) * heightPx }}>
												<span className="absolute -top-2 right-2 bg-white px-1 text-[10px] text-neutral-400">page break</span>
											</div>
										))}
								</div>
							</div>
						)}
					</div>
				</div>
			</div>

			{dialog === "proofing" && (
				<ProofingDialog
					text={textOfBlocks(editor.document as unknown as BlockLike[])}
					readOnly={readOnly}
					onClose={() => setDialog(null)}
					replace={(from, to) => {
						const r = replaceInBlocks(editor.document as unknown as BlockLike[], from, to, true, true);
						editor.transact(() => r.changed.forEach((c) => editor.updateBlock(c.id, { content: c.content } as never)));
						return r.count;
					}}
				/>
			)}
			{dialog === "headerFooter" && <HeaderFooterDialog value={hf} onClose={() => setDialog(null)} onSave={(v) => { saveHf(v); setDialog(null); }} />}
			{dialog === "counts" && (
				<Dialog isOpen onOpenChange={(o) => !o && setDialog(null)} className="max-w-sm">
					<div className="space-y-3 text-sm">
						<DialogHeading icon={<Info className="size-6" />} title="Word Count" />
						<dl className="grid grid-cols-[1fr_auto] gap-1">
							<dt>Pages (approximate)</dt>
							<dd className="font-mono">{pages}</dd>
							<dt>Words</dt>
							<dd className="font-mono">{words.words.toLocaleString()}</dd>
							<dt>Characters (no spaces)</dt>
							<dd className="font-mono">{words.charactersNoSpaces.toLocaleString()}</dd>
							<dt>Characters (with spaces)</dt>
							<dd className="font-mono">{words.characters.toLocaleString()}</dd>
							<dt>Paragraphs</dt>
							<dd className="font-mono">{words.paragraphs.toLocaleString()}</dd>
						</dl>
						<DialogFooter>
							<Button onPress={() => setDialog(null)}>Close</Button>
						</DialogFooter>
					</div>
				</Dialog>
			)}
			{dialog === "update" && (
				<Dialog isOpen onOpenChange={(o) => !o && setDialog(null)} className="max-w-md">
					<div className="space-y-4 text-sm">
						<DialogHeading icon={<FilePenLine className="size-6" />} title="Replace the File" />
						<p>This replaces {name} in the workspace with what the document holds now, and everyone gets the new file.</p>
						<DialogFooter>
							<Button variant="outline" onPress={() => setDialog(null)}>
								Cancel
							</Button>
							<Button
								onPress={() => {
									setDialog(null);
									void onUpdateFile(html(), layout, anonymous);
								}}
							>
								Replace the File
							</Button>
						</DialogFooter>
					</div>
				</Dialog>
			)}
		</OfficeFrame>
	);
}

function HeaderFooterDialog({ value, onSave, onClose }: { value: HeaderFooter; onSave: (v: HeaderFooter) => void; onClose: () => void }) {
	const [v, setV] = useState(value);
	return (
		<Dialog isOpen onOpenChange={(o) => !o && onClose()} className="max-w-md">
			<form
				className="space-y-3 text-sm"
				onSubmit={(e) => {
					e.preventDefault();
					onSave(readHeaderFooter(v));
				}}
			>
				<DialogHeading icon={<Printer className="size-6" />} title="Header & Footer" />
				<label className="block">
					<span className="mb-1 block text-muted-foreground">Header</span>
					<input aria-label="Header" value={v.header} onChange={(e) => setV({ ...v, header: e.target.value })} maxLength={200} className="h-8 w-full border bg-background px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring" />
				</label>
				<label className="block">
					<span className="mb-1 block text-muted-foreground">Footer</span>
					<input aria-label="Footer" value={v.footer} onChange={(e) => setV({ ...v, footer: e.target.value })} maxLength={200} className="h-8 w-full border bg-background px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring" />
				</label>
				<label className="flex items-center gap-2">
					<input type="checkbox" checked={v.pageNumbers} onChange={(e) => setV({ ...v, pageNumbers: e.target.checked })} />
					Page numbers in the footer
				</label>
				<DialogFooter>
					<Button type="button" variant="outline" onPress={onClose}>
						Cancel
					</Button>
					<Button type="submit">OK</Button>
				</DialogFooter>
			</form>
		</Dialog>
	);
}

// The ruler over the page: inches along it, and the margins shaded
function Ruler({ widthPx, box, zoom }: { widthPx: number; box: ReturnType<typeof pageBox>; zoom: number }) {
	const inches = box.width / 72;
	const ticks = Array.from({ length: Math.floor(inches * 8) + 1 }, (_, i) => i);
	return (
		<div className="sticky top-0 z-10 flex justify-center bg-[#f3f2f1] pt-1 dark:bg-neutral-800" aria-hidden style={{ zoom: zoom / 100 }}>
			<div className="relative h-5 border-x border-b bg-white text-[9px] text-neutral-500" style={{ width: widthPx }}>
				<div className="absolute inset-y-0 left-0 bg-neutral-300" style={{ width: box.left * PX_PER_PT }} />
				<div className="absolute inset-y-0 right-0 bg-neutral-300" style={{ width: box.right * PX_PER_PT }} />
				{ticks.map((i) => {
					const x = (i / 8) * 96;
					const major = i % 8 === 0;
					const half = i % 4 === 0;
					return (
						<span key={i} className="absolute bottom-0 border-l border-neutral-400" style={{ left: x, height: major ? 10 : half ? 7 : 4 }}>
							{major && i > 0 && <span className="absolute -top-3 left-0.5">{i / 8}</span>}
						</span>
					);
				})}
			</div>
		</div>
	);
}
