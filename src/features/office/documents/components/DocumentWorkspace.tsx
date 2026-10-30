import { BlockNoteView } from "@blocknote/mantine";
import { withCollaboration } from "@blocknote/core/yjs";
import { useCreateBlockNote } from "@blocknote/react";
import { Download, FilePenLine, History, Info, Printer, Redo2, RotateCcw, Save, Undo2, X } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as Y from "yjs";

import "@blocknote/mantine/style.css";

import { MergeDialog, SourcesDialog, useSources } from "@/features/office/documents/components/ReferencesDialogs";
import { citation } from "@/features/office/documents/lib/documentReferences";
import { smartQuotesPlugin, forFile } from "@/features/office/documents/lib/documentTools";
import { listLevelsPlugin } from "@/features/office/documents/lib/documentObjects";
import { commentsPlugin, newCommentStore } from "@/features/office/documents/lib/documentComments";
import { useDocumentComments } from "@/features/office/documents/components/useDocumentComments";
import DocumentInspector from "@/features/office/documents/components/DocumentInspector";
import DocumentRibbon from "@/features/office/documents/components/DocumentRibbon";
import PrintView from "@/features/office/documents/components/PrintView";
import ProofingDialog from "@/features/office/documents/components/ProofingDialog";
import CompareDialog from "@/features/office/documents/components/CompareDialog";
import { documentOutline } from "@/features/office/documents/lib/documentOutline";
import NotesDialog from "@/features/office/documents/components/NotesDialog";
import { notesToSend, referencesIn, withReferences, type NoteDef, type NoteWire } from "@/features/office/documents/lib/documentNotes";
import { editedStyles, fromFile, galleryStyles, type StyleDef, type StyleIn, type StyleOut } from "@/features/office/documents/lib/documentStyles";
import { access, isRestriction, type Restriction } from "@/features/office/documents/lib/documentRestrict";
import { useChat } from "@/store/chat/ChatContext";
import AccessibilityDialog from "@/features/office/documents/components/AccessibilityDialog";
import { useDocumentReview } from "@/features/office/documents/components/useDocumentReview";
import { changesOf, newReviewStore, resolvedSetOf, staleMarksPlugin, suggestingPlugin } from "@/features/office/documents/lib/documentReview";
import { useDocumentActions } from "@/features/office/documents/components/useDocumentActions";
import Backstage from "@/features/office/shared/Backstage";
import HistoryPanel from "@/features/office/shared/HistoryPanel";
import { OfficeFrame, ZoomBar, ACCENTS, type RibbonTab } from "@/features/office/shared/Ribbon";
import { PeopleStack, usePeople } from "@/features/office/shared/People";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter, DialogHeading } from "@/components/ui/dialog";
import Loading from "@/components/Loading";
import type { CollabDoc } from "@/hooks/useCollabDoc";
import { useSeedOnce } from "@/hooks/useSeedOnce";
import { colorOf } from "@/lib/collabColor";
import { officeMargins } from "@/lib/tauri";
import { setupFromLayout } from "@/features/office/documents/lib/documentFormat";
import { paginate } from "@/features/office/documents/lib/pagination";
import { pagePushPlugin, pushesOf, setPushes, splitsOf } from "@/features/office/documents/lib/pagePush";
import { fillDone, setLegacySpacing, setListDefinitions, wordLayoutPlugin, type ListLevel, type ParaSpacing } from "@/features/office/documents/lib/wordLayout";
import { countText, DEFAULT_PAGE, fontStack, NO_HEADER, pageBox, pageCount, PX_PER_PT, readHeaderFooter, readPage, textFor, type HeaderFooter, type PageSetup } from "@/features/office/documents/lib/documentFormat";
import { lineMarks, type LineMark } from "@/features/office/documents/lib/lineNumbers";
import { firstMatch, headingsOf, replaceInBlocks, textOfBlocks, type BlockLike } from "@/features/office/documents/lib/documentFind";
import { documentSchema } from "@/features/office/documents/lib/documentSchema";
import { cn } from "@/lib/utils";
import type { OfficeInspect, OfficeLayout } from "@/features/office/types";

const TABS: RibbonTab[] = [
	{ id: "home", label: "Home" },
	{ id: "insert", label: "Insert" },
	{ id: "layout", label: "Layout" },
	{ id: "references", label: "References" },
	{ id: "mailings", label: "Mailings" },
	{ id: "review", label: "Review" },
	{ id: "view", label: "View" },
];

// The space between two sheets on the screen, in pixels
const PAGE_GAP = 24;

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
	firstHeader?: string;
	firstFooter?: string;
	evenHeader?: string;
	evenFooter?: string;
	pageNumbers: boolean;
	valign: string;
	// Paragraph styles made or changed in the editor, to write into the file's styles
	styles?: StyleIn[];
	// The notes the text refers to
	notes?: NoteWire[];
	// Comments to write into the file as its own comments
	comments?: { quote: string; author: string; text: string; date: string; resolved: boolean; replies: { author: string; text: string; date: string }[] }[];
}

export function layoutOf(setup: PageSetup, hf: HeaderFooter): Layout {
	const b = pageBox(setup);
	return { width: b.width, height: b.height, landscape: setup.landscape, top: b.top, right: b.right, bottom: b.bottom, left: b.left, columns: setup.columns, spacing: setup.spacing, header: hf.header, footer: hf.footer, firstHeader: hf.firstHeader ?? "", firstFooter: hf.firstFooter ?? "", evenHeader: hf.evenHeader ?? "", evenFooter: hf.evenFooter ?? "", pageNumbers: hf.pageNumbers, valign: setup.valign };
}

interface Props {
	collab: CollabDoc;
	// The file's text: the blocks the backend made of it (every paragraph carrying its Word formatting), or HTML (a sample, a paste)
	initialBlocks: unknown[] | string;
	// The definitions of the file's lists, for numbering them as they change
	lists?: Record<string, ListLevel>;
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
	// The page set-up the file has (the settings start from it) and the file as the backend read it
	fileLayout?: OfficeLayout | null;
	sourceId?: string | null;
	// Reads the file again, for putting it back in place of the shared copy; null when it could not be read (the page says why)
	// Where the file is, for its version history
	history?: { workspacePath: string; rel: string };
	canComment?: boolean;
	// The paragraph styles the file has, for the Styles gallery
	styles?: StyleOut[];
	// The footnotes and endnotes the file has
	notes?: NoteWire[];
	onReload?: () => Promise<{ blocks: unknown[]; layout?: OfficeLayout | null; lists?: Record<string, ListLevel>; notes?: NoteWire[] } | null>;
}

// A header or footer written as left, middle and right parts (Word separates them with tabs) is drawn so
const zones = (text: string) => (text.includes("	") ? text.split("	").slice(0, 3) : [text]);

// A document, laid out like a word processor: a ribbon of the things people do to text, a page on a desk with a ruler, a navigation
// pane of headings, and a status bar. The text is shared live; so are the page set-up and the header and footer.
function DocumentWorkspace({ collab, initialBlocks, lists, name, title, author, readOnly: baseReadOnly, inspect, canUpdateFile, onSaveCopy, onUpdateFile, notice, fileLayout, sourceId, onReload, history, canComment: baseCanComment = false, styles, notes: fileNotes }: Props) {
	const doc = collab.doc;
	// An Owner or Admin may make the document comments-only or read-only for the others; it is kept in the shared document
	const chatRole = useChat().role;
	const isAdmin = chatRole === "Owner" || chatRole === "Admin";
	const settings = useMemo(() => doc.getMap<string>("docSettings"), [doc]);
	const [restriction, setRestrictionState] = useState<Restriction>(() => (isRestriction(settings.get("restrict")) ? (settings.get("restrict") as Restriction) : "none"));
	useEffect(() => {
		const read = () => setRestrictionState(isRestriction(settings.get("restrict")) ? (settings.get("restrict") as Restriction) : "none");
		read();
		settings.observe(read);
		return () => settings.unobserve(read);
	}, [settings]);
	const { readOnly, canComment } = access(restriction, isAdmin, { readOnly: baseReadOnly, canComment: baseCanComment });
	const restricted = restriction !== "none" && !isAdmin;
	const commentStore = useMemo(newCommentStore, []);
	const reviewStore = useMemo(() => newReviewStore(author, resolvedSetOf(doc.getMap<boolean>("resolvedChanges"))), [author, doc]);
	const options = useMemo(
		() =>
			withCollaboration({
				schema: documentSchema,
				tables: { splitCells: true, headers: true },
				// Given at creation, so they are in the view the editor makes once the shared copy has loaded (one registered later is lost)
				extensions: [
					() => ({ key: "pagePush", prosemirrorPlugins: [pagePushPlugin] }),
					() => ({ key: "wordLayout", prosemirrorPlugins: [wordLayoutPlugin] }),
					() => ({ key: "docComments", prosemirrorPlugins: [commentsPlugin(commentStore)] }),
					() => ({ key: "docReview", prosemirrorPlugins: [suggestingPlugin(reviewStore), staleMarksPlugin(reviewStore)] }),
					() => ({ key: "smartQuotes", prosemirrorPlugins: [smartQuotesPlugin] }),
					() => ({ key: "listLevels", prosemirrorPlugins: [listLevelsPlugin] }),
				],
				collaboration: { fragment: doc.getXmlFragment("blocknote"), user: { name: author, color: colorOf(author) }, provider: { awareness: collab.awareness } },
			}),
		[doc, collab.awareness, author],
	);
	const editor = useCreateBlockNote(options, [doc]);
	const styleDefs = useMemo(() => doc.getMap<Record<string, unknown>>("styleDefs"), [doc]);
	// The document's named styles, shared: the file's own come in when it is opened, and the ones made or changed here go back into the file
	const sheet = useMemo(() => doc.getMap<StyleDef>("styleSheet"), [doc]);
	const [styleList, setStyleList] = useState<StyleDef[]>([]);
	useEffect(() => {
		const read = () => setStyleList([...sheet.values()]);
		read();
		sheet.observe(read);
		return () => sheet.unobserve(read);
	}, [sheet]);
	useEffect(() => {
		const missing = (styles ?? []).filter((s) => !sheet.has(s.id));
		if (missing.length > 0 && !baseReadOnly) doc.transact(() => missing.forEach((s) => sheet.set(s.id, fromFile(s))));
	}, [styles, sheet, doc, baseReadOnly]);
	// The words of the footnotes and endnotes, shared; the text holds only the references (see `documentNotes`)
	const noteMap = useMemo(() => doc.getMap<NoteDef>("notes"), [doc]);
	const [noteTick, setNoteTick] = useState(0);
	useEffect(() => {
		const again = () => setNoteTick((t) => t + 1);
		noteMap.observe(again);
		return () => noteMap.unobserve(again);
	}, [noteMap]);
	// The notes of a file replace the document's own (a file read again brings its notes with it); the document then sends its notes with the text
	const putNotes = (list: NoteWire[]) =>
		doc.transact(() => {
			[...noteMap.keys()].forEach((k) => noteMap.delete(k));
			list.forEach((n) => noteMap.set(String(n.id), { end: n.end, text: n.text }));
			doc.getMap<string>("docmeta").set("notesKnown", "1");
		});
	const a = useDocumentActions(editor, styleDefs, sheet, noteMap);
	const src = useSources(doc);
	const comments = useDocumentComments(editor, commentStore, history?.rel ?? name, canComment);
	const review = useDocumentReview(editor, reviewStore);
	const people = usePeople(collab.awareness);

	// The editor can take text once its view exists, which is after the page has drawn it
	const [mounted, setMounted] = useState(false);
	useEffect(() => {
		// The editor has a view before it is on the page; what is handed to that one is lost when it is put on the page
		setMounted(false);
		const off = editor.onMount(() => setMounted(true));
		const offUn = editor.onUnmount(() => setMounted(false));
		try {
			if (editor.prosemirrorView?.dom.isConnected) setMounted(true);
		} catch {
			// Not mounted yet: onMount says when
		}
		return () => {
			off?.();
			offUn?.();
		};
	}, [editor]);

	// Documents put in before blocks carried their Word formatting keep their spacing here, by block id (see `wordLayout`)
	const spacing = doc.getMap<string>("paraSpacing");
	const [seeding, setSeeding] = useState<{ done: number; total: number } | null>(null);
	useEffect(() => {
		if (!mounted) return;
		const apply = (keys: Iterable<string>) => {
			const m = new Map<string, ParaSpacing>();
			for (const k of keys) {
				if (k === "version") continue;
				try {
					const v = spacing.get(k);
					if (v) m.set(k, JSON.parse(v));
				} catch {
					// A damaged value is ignored
				}
			}
			try {
				if (editor.prosemirrorView) setLegacySpacing(editor.prosemirrorView, m);
			} catch {
				// Not mounted
			}
		};
		apply(spacing.keys());
		const changed = (e: Y.YMapEvent<string>) => apply(e.keysChanged);
		spacing.observe(changed);
		return () => spacing.unobserve(changed);
	}, [editor, mounted, spacing]);
	// Puts a file's text in place of everything in the document, a piece at a time so the window keeps answering while it fills
	const fill = useCallback(
		async (source: unknown[] | string) => {
			const blocks = (typeof source === "string" ? editor.tryParseHTMLToBlocks(source) : source) as never[];
			const step = 120;
			const total = Math.max(1, Math.ceil(blocks.length / step));
			setSeeding({ done: 0, total });
			try {
				for (let i = 0; i < total; i++) {
					const piece = blocks.slice(i * step, (i + 1) * step);
					editor.transact((tr) => {
						tr.setMeta("wordLayoutFill", true);
						if (i === 0) editor.replaceBlocks(editor.document, piece);
						else editor.insertBlocks(piece, editor.document[editor.document.length - 1] as never, "after");
					});
					setSeeding({ done: i + 1, total });
					await new Promise((r) => setTimeout(r, 0));
				}
			} finally {
				if (editor.prosemirrorView) fillDone(editor.prosemirrorView);
				setSeeding(null);
			}
		},
		[editor],
	);
	// The file is the first text of a document nobody has opened before
	useSeedOnce(
		collab.synced && mounted,
		() => {
			// A document nobody has written in holds nothing, or the one empty paragraph the editor starts with
			const first = editor.document[0] as unknown as { type: string; content?: unknown[] } | undefined;
			const blank = doc.getXmlFragment("blocknote").length === 0 || (editor.document.length === 1 && first?.type === "paragraph" && (first.content?.length ?? 0) === 0);
			if (!blank || !initialBlocks.length) return;
			if (lists) meta.set("lists", JSON.stringify(lists));
			putNotes(fileNotes ?? []);
			void fill(Array.isArray(initialBlocks) ? withReferences(initialBlocks, fileNotes ?? []) : initialBlocks);
		},
		[collab, editor, initialBlocks, mounted],
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
	useEffect(() => {
		if (!mounted) return;
		const read = () => {
			try {
				const view = editor.prosemirrorView;
				if (view) setListDefinitions(view, JSON.parse(meta.get("lists") ?? "{}"));
			} catch {
				// Not mounted, or a damaged value: the labels the file gave are shown
			}
		};
		// A task of its own: numbering a long document's lists draws every block again, and the window should get a turn between
		// that and drawing the document when it arrives
		let timer: number | undefined;
		const later = () => {
			clearTimeout(timer);
			timer = window.setTimeout(read);
		};
		later();
		meta.observe(later);
		return () => {
			meta.unobserve(later);
			clearTimeout(timer);
		};
	}, [editor, meta, mounted]);
	// Choosing a paper size, margins or orientation replaces the page a file came with
	// A file's own page set-up is where the settings start, the first time anyone opens it
	useEffect(() => {
		if (!collab.synced || !fileLayout || meta.has("page")) return;
		const { page: p, hf: h } = setupFromLayout(fileLayout);
		doc.transact(() => {
			meta.set("page", JSON.stringify(p));
			meta.set("headerFooter", JSON.stringify(h));
		});
	}, [collab.synced, fileLayout, meta, doc]);
	const setPage = (patch: Partial<PageSetup>) => meta.set("page", JSON.stringify({ ...page, ...patch, ...("paper" in patch || "margins" in patch || "landscape" in patch ? { custom: undefined } : {}) }));
	const saveHf = (next: HeaderFooter) => meta.set("headerFooter", JSON.stringify(next));

	const [tab, setTab] = useState("home");
	const [anonymous, setAnonymous] = useState(false);
	const [withComments, setWithComments] = useState(false);
	const [zoom, setZoomState] = useState(100);
	const [view, setViewState] = useState({ ruler: true, navigation: false, mode: "edit" as "print" | "edit" | "web" | "read", spelling: true, focus: false, marks: false, dark: false });
	const setView = (v: Partial<typeof view>) => setViewState((c) => ({ ...c, ...v }));
	const pageEl = useRef<HTMLDivElement>(null);
	const [marks, setMarks] = useState<LineMark[]>([]);
	const [find, setFind] = useState<{ replace: boolean; query: string; with: string; cs: boolean; rx: boolean; note: string } | null>(null);
	const [taskMade, setTaskMade] = useState(false);
	const makeTask = async () => {
		if (!history) return;
		try {
			if (await comments.makeTask(history.workspacePath)) {
				setTaskMade(true);
				setTimeout(() => setTaskMade(false), 2000);
			}
		} catch {
			// The task could not be made; nothing was changed in the document
		}
	};
	const [outlineCopied, setOutlineCopied] = useState(false);
	// The document as JSON on the clipboard: what a script or an assistant would read instead of the page
	const copyOutline = async () => {
		const outline = documentOutline(editor.document as unknown as BlockLike[], {
			trackedChanges: changesOf(editor.prosemirrorState.doc).map((c) => ({ kind: c.kind, author: c.author, date: c.date, text: c.text })),
			comments: comments.list(false).map((c) => ({ author: c.author, text: c.text, resolved: c.resolved })),
		});
		try {
			await navigator.clipboard.writeText(JSON.stringify(outline, null, 2));
			setOutlineCopied(true);
			setTimeout(() => setOutlineCopied(false), 2000);
		} catch {
			// The clipboard is not available in this window; nothing was copied
		}
	};
	const [dialog, setDialog] = useState<"headerFooter" | "counts" | "update" | "proofing" | "reload" | "sources" | "merge" | "compare" | "accessibility" | "notes" | null>(null);
	// Puts the file back in place of the shared copy, for everyone: the text as the file has it now, with its spacing, page set-up and
	// header and footer
	const reload = async () => {
		setDialog(null);
		const fresh = onReload ? await onReload() : { blocks: typeof initialBlocks === "string" ? editor.tryParseHTMLToBlocks(initialBlocks) : initialBlocks, layout: fileLayout, lists, notes: fileNotes };
		if (!fresh || !fresh.blocks.length) return;
		// (The spacing kept for the blocks being replaced stays, so that undoing the reload brings them back as they were)
		doc.transact(() => {
			if (fresh.lists) meta.set("lists", JSON.stringify(fresh.lists));
			putNotes(fresh.notes ?? []);
			if (fresh.layout) {
				const { page: p, hf: h } = setupFromLayout(fresh.layout);
				meta.set("page", JSON.stringify(p));
				meta.set("headerFooter", JSON.stringify(h));
			}
		});
		// The file goes in a piece at a time; the shared undo is told to keep the pieces together, so one undo takes the reload back
		type Undo = { captureTimeout: number; stopCapturing: () => void };
		let undo: Undo | undefined;
		try {
			const state = editor.prosemirrorView!.state;
			undo = (state.plugins.find((p) => (p as unknown as { key: string }).key === "y-undo$")?.getState(state) as { undoManager?: Undo } | undefined)?.undoManager;
		} catch {
			// No shared undo: the reload is simply not one step
		}
		const timeout = undo?.captureTimeout ?? 500;
		undo?.stopCapturing();
		if (undo) undo.captureTimeout = Number.POSITIVE_INFINITY;
		try {
			await fill(withReferences(fresh.blocks, fresh.notes ?? []));
		} finally {
			undo?.stopCapturing();
			if (undo) undo.captureTimeout = timeout;
		}
	};
	const scroller = useRef<HTMLDivElement>(null);
	const body = useRef<HTMLDivElement>(null);
	const picker = useRef<HTMLInputElement>(null);

	const mode = view.mode;
	// Line numbers are counted again after the text, the page or the zoom changes (once per frame at most)
	useEffect(() => {
		if (!page.lineNumbers || mode !== "edit") return setMarks([]);
		let frame = 0;
		const count = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => pageEl.current && setMarks(lineMarks(pageEl.current, zoom / 100)));
		};
		count();
		const off = editor.onChange(count);
		return () => {
			cancelAnimationFrame(frame);
			off?.();
		};
	}, [editor, page, mode, zoom, collab.synced]);
	const box = pageBox(page);
	const widthPx = box.width * PX_PER_PT;
	const heightPx = box.height * PX_PER_PT;

	// The text is one flow, laid out on sheets: each block is pushed down just enough that it does not straddle the gap between two pages,
	// and the sheets are drawn behind it, as many as the text fills. (With columns, or outside Print Layout, it is one long sheet.)
	const [bodyHeight, setBodyHeight] = useState(0);
	const paged = mode === "edit" && page.columns <= 1;
	const [flowPages, setFlowPages] = useState(1);
	// The text goes between the margins; a header or footer of the file's that reaches into them takes that much more off, as in Word
	// (set once the backend has laid one out, see `margins` below)
	const [textArea, setTextArea] = useState<{ top: number; height: number } | null>(null);
	const area = textArea && sourceId ? textArea : { top: box.top, height: box.height - box.top - box.bottom };
	const roomPx = area.height * PX_PER_PT;
	const gapPx = (box.height - area.height) * PX_PER_PT + PAGE_GAP;
	useEffect(() => {
		const el = body.current;
		// While the file is being put in, the pages are not worked out; they are, once, when it is all there
		if (!el || seeding) return;
		let timer: number | undefined;
		// Every block, nested ones too, in document order
		const outers = () => Array.from(el.querySelectorAll<HTMLElement>(".bn-editor .bn-block-outer"));
		const run = () => {
			timer = undefined;
			// A minimized window has no size to lay pages out in; the resize that brings it back works them out
			if (document.hidden || el.offsetWidth === 0) return;
			setBodyHeight(el.offsetHeight);
			let view;
			try {
				view = editor.prosemirrorView;
			} catch {
				return;
			}
			if (!view) return;
			if (!paged) {
				setPushes(view, []);
				return setFlowPages(1);
			}
			const list = outers();
			const applied = pushesOf(view);
			const cuts = splitsOf(view);
			const rect = el.getBoundingClientRect();
			const scale = el.offsetHeight > 0 ? rect.height / el.offsetHeight : 1;
			// Where each block would be with no spacing: where it is now, less the spacing above it (its own is inside its box). This runs
			// over every block of the document, so it reads only what it needs: positions, and the block's own inline style.
			let above = 0;
			let prevKeep = false;
			const measured = list.map((o, i) => {
				const r = o.getBoundingClientRect();
				const own = applied[i] ?? 0;
				const cut = cuts[i];
				const block = o.firstElementChild;
				const content = block?.firstElementChild as HTMLElement | null | undefined;
				const nested = block?.children[1]?.classList.contains("bn-block-group");
				const kind = content?.dataset.contentType;
				const table = kind === "table";
				// A block with blocks nested in it is measured to the end of its own text; the nested ones are measured on their own.
				// (A table broken over two pages is measured without the empty row that does it.)
				const height = (nested && content ? content.getBoundingClientRect().bottom - r.top : r.height) / scale - own - (cut?.px ?? 0);
				// The space after it, from the file's spacing (points, on the block's content; see `wordLayout`)
				const after = nested ? 0 : (parseFloat(content?.dataset.nxAfter ?? "") || 0) * PX_PER_PT;
				// How much of it has to share a page with a heading before it that keeps with it (only wanted then): a table's first row, a
				// paragraph's first line, or with widow and orphan control (Word's default) the lines it cannot be split before: all of a
				// paragraph of three lines or fewer, else its first two
				let first: number | undefined;
				if (prevKeep && content) {
					const line = table ? content.querySelector("tr") : (content.firstElementChild as HTMLElement | null);
					const lr = line?.getBoundingClientRect();
					const lh = line && !table ? parseFloat(getComputedStyle(line).lineHeight) * scale : NaN;
					if (lr && Number.isFinite(lh) && lh > 0) {
						const lines = Math.max(1, Math.round(lr.height / lh));
						const keep = content.dataset.widowControl === "false" ? 1 : lines <= 3 ? lines : 2;
						first = (Math.min(lr.bottom, lr.top + lr.height * (keep / lines)) - r.top) / scale - own;
					} else if (lr) first = (lr.bottom - r.top) / scale - own;
				}
				// A table's rows, from its top, as they would be without a break applied to it
				const rows = table
					? Array.from(o.querySelectorAll("tr:not(.nx-row-gap)")).map((tr, k): [number, number] => {
							const tb = tr.getBoundingClientRect();
							const back = cut && k >= cut.at ? cut.px * scale : 0;
							return [(tb.top - back - r.top) / scale - own, (tb.bottom - back - r.top) / scale - own];
						})
					: undefined;
				const keepNext = content?.classList.contains("nx-sp") ? content.dataset.nxKeep === "1" : kind === "heading";
				prevKeep = keepNext;
				const m = { rows, first, after, top: (r.top - rect.top) / scale - above, height, keepNext, breakBefore: content?.dataset.nxBrk === "1", valign: content?.dataset.nxValign };
				above += own + (cut?.px ?? 0);
				return m;
			});
			const result = paginate(measured, roomPx, gapPx);
			// A page whose text sits in the middle or at the bottom: shown so while the text fits on one page
			const last = measured[measured.length - 1];
			if (result.pages === 1 && last && (page.valign === "center" || page.valign === "bottom")) {
				const free = roomPx - (last.top + last.height);
				if (free > 0) result.push[0] += page.valign === "center" ? free / 2 : free;
			}
			setPushes(view, result.push, result.split);
			setFlowPages(result.pages);
		};
		// Worked out once things have been still for a moment: a pass over a long document takes a while, and typing should not
		// wait for one after every key
		const soon = () => {
			if (timer !== undefined) clearTimeout(timer);
			timer = window.setTimeout(run, 150);
		};
		// Fonts arriving change the height of lines without touching the text, and the window changes how it wraps
		const fonts = document.fonts;
		fonts?.ready.then(soon).catch(() => {});
		fonts?.addEventListener?.("loadingdone", soon);
		window.addEventListener("resize", soon);
		// A last look shortly after the text first appears, once everything has settled
		const settle = window.setTimeout(soon, 400);
		const ro = new ResizeObserver(soon);
		ro.observe(el);
		const mo = new MutationObserver(soon);
		mo.observe(el, { childList: true, characterData: true, subtree: true });
		// (in a task of its own, so the window gets a turn after the document is drawn)
		timer = window.setTimeout(run);
		return () => {
			ro.disconnect();
			mo.disconnect();
			fonts?.removeEventListener?.("loadingdone", soon);
			window.removeEventListener("resize", soon);
			clearTimeout(settle);
			if (timer !== undefined) clearTimeout(timer);
		};
	}, [editor, mounted, collab.synced, paged, roomPx, gapPx, page.spacing, page.valign, seeding === null]);
	const [printPages, setPrintPages] = useState(1);
	const pages = mode === "print" ? printPages : paged ? flowPages : pageCount(bodyHeight, box);
	const [pageAt, setPageAt] = useState(1);
	const onScroll = () => {
		const el = scroller.current;
		if (el) setPageAt(Math.min(pages, Math.max(1, Math.floor((el.scrollTop / ((zoom / 100) * (heightPx + PAGE_GAP))) + 0.5) + 1)));
	};

	// While the header and footer are still the file's own, they are drawn as the file has them (shapes, lines, page numbers) by the
	// backend, a picture per page behind the text, for the pages around the one in view
	const fileMargins = !!sourceId && paged && !!fileLayout && JSON.stringify(setupFromLayout(fileLayout).hf) === JSON.stringify(hf);
	const [margins, setMargins] = useState<Map<number, string>>(new Map());
	const asked = useRef({ pages: 0, set: new Set<number>() });
	useEffect(() => {
		if (!fileMargins || !sourceId) return;
		// A new page count lays the pages out again, so what was drawn for the old one is let go
		if (asked.current.pages !== pages) {
			asked.current = { pages, set: new Set() };
			setMargins(new Map());
		}
		const mine = asked.current;
		for (let p = Math.max(1, pageAt - 2); p <= Math.min(pages, pageAt + 2); p++) {
			if (mine.set.has(p)) continue;
			mine.set.add(p);
			officeMargins(sourceId, pages, p - 1, 2)
				.then((img) => {
					if (asked.current !== mine) return;
					setMargins((m) => new Map(m).set(p, `data:image/png;base64,${img.png}`));
					// The text area of an ordinary page (the first may have a header and footer of its own)
					if ((p > 1 || pages === 1) && img.bodyHeightPt > 0)
						setTextArea((a) => (a && Math.abs(a.top - img.bodyTopPt) < 0.01 && Math.abs(a.height - img.bodyHeightPt) < 0.01 ? a : { top: img.bodyTopPt, height: img.bodyHeightPt }));
				})
				.catch(() => mine.set.delete(p));
		}
	}, [fileMargins, sourceId, pages, pageAt]);

	const setZoom = (z: number) => {
		if (z === -1) {
			const w = (scroller.current?.clientWidth ?? 900) - (view.navigation ? 0 : 48);
			setZoomState(Math.max(50, Math.min(200, Math.floor((w / widthPx) * 100))));
		} else setZoomState(z);
	};

	// Read from the editor's own text: making blocks of a long document on every caret move is what made typing in one slow
	const words = useMemo(() => {
		try {
			const d = editor.prosemirrorState.doc;
			return countText(collab.synced ? d.textBetween(0, d.content.size, "\n", "\n") : "");
		} catch {
			return countText("");
		}
	}, [editor, collab.synced, bodyHeight, a.fmt]); // eslint-disable-line react-hooks/exhaustive-deps
	const headings = useMemo(() => (view.navigation ? headingsOf(editor.document as unknown as BlockLike[]) : []), [editor, view.navigation, bodyHeight, a.fmt]); // eslint-disable-line react-hooks/exhaustive-deps

	const html = useCallback(() => forFile(editor.blocksToHTMLLossy(editor.document as never)), [editor]);

	// Spelling: the browser's own checker marks the words
	useEffect(() => {
		const el = body.current?.querySelector<HTMLElement>(".bn-editor");
		el?.setAttribute("spellcheck", view.spelling ? "true" : "false");
	}, [view.spelling, collab.synced, editor]);

	// Ctrl+Z and Ctrl+Y undo and redo in the document wherever on its page the focus is, as in Word: a click on a table's handles or
	// on the page around the text takes the focus out of the text, and the keys would otherwise do nothing
	const actions = useRef(a);
	actions.current = a;
	useEffect(() => {
		if (readOnly) return;
		const onKey = (e: KeyboardEvent) => {
			const k = e.key.toLowerCase();
			if (!(e.ctrlKey || e.metaKey) || e.altKey || (k !== "z" && k !== "y")) return;
			const t = e.target as HTMLElement;
			if (t.closest?.(".ProseMirror, input, textarea, select, [contenteditable='true']")) return;
			if (t !== document.body && !scroller.current?.contains(t)) return;
			e.preventDefault();
			if (k === "y" || e.shiftKey) actions.current.redo();
			else actions.current.undo();
		};
		// Ctrl+Alt+1, 2, 3 make the paragraph Heading 1, 2, 3 and Ctrl+Alt+0 Normal, as in Word (Alt changes the key, so the code is read)
		const onStyle = (e: KeyboardEvent) => {
			const id = (e.ctrlKey || e.metaKey) && e.altKey && !e.shiftKey ? ({ Digit0: "normal", Digit1: "h1", Digit2: "h2", Digit3: "h3" } as Record<string, string>)[e.code] : undefined;
			if (!id || !(e.target as HTMLElement).closest?.(".ProseMirror")) return;
			e.preventDefault();
			actions.current.style(id);
		};
		window.addEventListener("keydown", onKey);
		window.addEventListener("keydown", onStyle);
		return () => {
			window.removeEventListener("keydown", onKey);
			window.removeEventListener("keydown", onStyle);
		};
	}, [readOnly]);

	const doFind = (backwards: boolean) => {
		if (!find?.query) return;
		// The browser's search is literal, so a pattern is looked for as the first text it matches
		const q = find.rx ? firstMatch(editor.document as unknown as BlockLike[], find.query, find.cs) : find.query;
		const found = !!q && (window as unknown as { find: (q: string, cs: boolean, back: boolean, wrap: boolean) => boolean }).find(q, find.cs, backwards, true);
		setFind({ ...find, note: found ? "" : "No match" });
	};
	const doReplace = (all: boolean) => {
		if (!find?.query) return;
		const blocks = editor.document as unknown as BlockLike[];
		if (!all) {
			const sel = editor.getSelectedText();
			const flags = find.cs ? "u" : "iu";
			try {
				if (find.rx ? new RegExp(`^(?:${find.query})$`, flags).test(sel) : sel.toLowerCase() === find.query.toLowerCase()) editor.insertInlineContent([find.rx ? sel.replace(new RegExp(find.query, flags), find.with) : find.with]);
			} catch {
				// An unfinished pattern replaces nothing
			}
			doFind(false);
			return;
		}
		const r = replaceInBlocks(blocks, find.query, find.with, find.cs, false, find.rx);
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

	// The notes to send: the ones the text refers to. A document made before notes were kept this way, from a file, leaves the file's notes alone.
	const notesNow = (): NoteWire[] | undefined => (sourceId && doc.getMap<string>("docmeta").get("notesKnown") !== "1" ? undefined : notesToSend(editor.document as never, new Map([...noteMap.entries()].map(([k, v]) => [Number(k), v]))));
	const layout = { ...layoutOf(page, hf), styles: editedStyles(styleList), notes: useMemo(notesNow, [bodyHeight, a.fmt, noteTick, sourceId]) }; // eslint-disable-line react-hooks/exhaustive-deps
	const accent = ACCENTS.word.color;
	const columnsCss = { ...(page.columns > 1 ? { columnCount: page.columns, columnGap: "0.5in" } : {}), "--doc-w": `${(box.width - box.left - box.right) * PX_PER_PT}px` } as React.CSSProperties;

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
							<label className="mb-2 flex items-center gap-2 text-sm">
								<input type="checkbox" checked={withComments} onChange={(e) => setWithComments(e.target.checked)} />
								Include the open comments (comments in .docx, at the end in the others)
							</label>
							{FORMATS.map((f) => (
								<button key={f.ext} type="button" onClick={() => void onSaveCopy(f.ext, html() + (withComments && f.ext !== "docx" ? comments.appendix() : ""), withComments && f.ext === "docx" ? { ...layout, comments: comments.list(anonymous) } : layout, anonymous)} className="block w-full border px-4 py-3 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
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
					id: "reload",
					label: "Reload from File",
					icon: RotateCcw,
					panel: (
						<div className="max-w-md space-y-3 text-sm">
							<h2 className="text-2xl font-light">Reload from File</h2>
							<p>
								Puts <b>{name}</b> back as the file has it now, in place of what the document holds, for everyone who has it open. Use it to see the file as it is, or to start again from it.
							</p>
							<p className="text-muted-foreground">Changes made in the document since it was opened from the file are replaced. Undo brings them back.</p>
							<Button isDisabled={readOnly || !!seeding} onPress={() => setDialog("reload")}>
								Reload from File…
							</Button>
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
						{ id: "history", label: "Version History", icon: History, panel: history ? <HistoryPanel workspacePath={history.workspacePath} rel={history.rel} readOnly={readOnly} /> : null },
					]}
		/>
	);

	return (
		<OfficeFrame
			accent="word"
			name={title}
			state={restricted ? "Restricted" : readOnly ? "Read-only" : "Shared"}
			tabs={TABS}
			tab={tab}
			onTab={setTab}
			quick={
				<>
					<button type="button" aria-label="Save a copy" title="Save a copy" onClick={() => setTab("file")} className="flex size-7 items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
						<Save className="size-4" />
					</button>
					<button type="button" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={readOnly} onClick={a.undo} className="flex size-7 items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
						<Undo2 className="size-4" />
					</button>
					<button type="button" aria-label="Redo" title="Redo (Ctrl+Y)" disabled={readOnly} onClick={a.redo} className="flex size-7 items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
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
					openFind={(replace) => setFind({ replace, query: find?.query ?? "", with: find?.with ?? "", cs: false, rx: find?.rx ?? false, note: "" })}
					openHeaderFooter={() => setDialog("headerFooter")}
					openCounts={() => setDialog("counts")}
					openProofing={() => setDialog("proofing")}
					review={review}
					openCompare={() => setDialog("compare")}
					openAccessibility={() => setDialog("accessibility")}
					styles={galleryStyles(styleList)}
					restrict={{ value: restriction, canSet: isAdmin && !baseReadOnly, set: (r) => settings.set("restrict", r) }}
					copyOutline={() => void copyOutline()}
					makeTask={() => void makeTask()}
					taskMade={taskMade}
					outlineCopied={outlineCopied}
					comments={{ open: comments.open, count: comments.count, canComment, start: comments.start, toggle: comments.toggle, next: comments.next, previous: comments.previous }}
					pickImage={pickImage}
					paste={() => void paste()}
					hasHeaderFooter={!!(hf.header || hf.footer || hf.pageNumbers || hf.firstHeader || hf.firstFooter || hf.evenHeader || hf.evenFooter)}
					fieldValues={() => ({ title, author, pages, words: countText(editor.prosemirrorState.doc.textBetween(0, editor.prosemirrorState.doc.content.size, "\n", "\n")).words })}
					refs={{
						crossRefs: () => {
							const blocks = editor.document as unknown as BlockLike[];
							const captions = blocks.map((b) => textOfBlocks([{ ...b, children: [] }]).trim()).filter((t) => /^(Figure|Table) [0-9]+/.test(t)).map((t) => /^(Figure|Table) [0-9]+/.exec(t)![0]);
							return [...captions, ...headingsOf(blocks).map((h) => h.text)];
						},
						citations: src.sources.map((s, i) => ({ label: `${s.author} ${s.year}`, text: citation(s, src.style, i + 1) })),
						openSources: () => setDialog("sources"),
						openMerge: () => setDialog("merge"),
						openNotes: () => setDialog("notes"),
					}}
				/>
			}
			file={file}
			status={
				<>
					<span>
						Page {pageAt} of {pages}
					</span>
					<button type="button" onClick={() => setDialog("counts")} className="outline-none hover:underline focus-visible:ring-1 focus-visible:ring-ring">
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
						<label className="flex items-center gap-1">
							<input type="checkbox" checked={find.rx} onChange={(e) => setFind({ ...find, rx: e.target.checked, note: "" })} />
							Regular expression
						</label>
						<span className="text-muted-foreground">{find.note}</span>
						<span className="flex-1" />
						<Button variant="ghost" size="icon-xs" aria-label="Close find" onPress={() => setFind(null)}>
							<X className="size-3.5" />
						</Button>
					</div>
				)}
				<div className="flex min-h-0 flex-1">
					{view.navigation && !view.focus && (
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
						{view.ruler && !view.focus && mode === "edit" && <Ruler widthPx={widthPx} box={box} zoom={zoom} />}
						{seeding && (
							<p role="status" className="sticky top-0 z-20 bg-[var(--office)] px-3 py-1 text-center text-xs text-white">
								Opening the document… {Math.round((seeding.done / Math.max(1, seeding.total)) * 100)}%
							</p>
						)}
						{!collab.synced ? (
							<Loading className="h-48" />
						) : (
							<>
							{mode === "print" && (
								<PrintView getHtml={html} subscribe={(cb) => editor.onChange(cb)} title={title} layout={layout} sourceId={sourceId} zoom={zoom} onPages={setPrintPages} />
							)}
							<div className={cn("flex justify-center-safe py-6", mode === "print" && "hidden")} style={{ zoom: zoom / 100 }}>
								<div
									ref={pageEl} className={cn("doc-page relative shrink-0 text-black", view.marks && "doc-marks", view.dark && "doc-dark", page.dropCap && "doc-dropcap", page.hyphenate && "doc-hyphen", page.banded && "doc-banded")}
									style={
										{
											width: mode === "edit" ? widthPx : Math.min(widthPx, 920),
											minHeight: paged ? pages * heightPx + (pages - 1) * PAGE_GAP : mode === "edit" ? pages * heightPx : undefined,
											padding: mode === "edit" ? `${(paged ? area.top : box.top) * PX_PER_PT}px ${box.right * PX_PER_PT}px ${box.bottom * PX_PER_PT}px ${box.left * PX_PER_PT}px` : "48px 56px",
											"--doc-font": fontStack(fileLayout?.font || "Calibri"),
											"--doc-size": fileLayout?.size ? `${fileLayout.size}pt` : undefined,
											"--doc-ls": String(page.spacing),
										} as React.CSSProperties
									}
								>
									{marks.map((m) => (
										<span key={m.n} aria-hidden className="pointer-events-none absolute z-10 w-8 text-right text-[9pt] leading-none text-neutral-500 select-none" style={{ left: -40, top: m.top }}>
											{m.n}
										</span>
									))}
									{page.watermark && mode !== "print" && (
										<div aria-hidden className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center overflow-hidden">
											<span className="-rotate-45 text-[96px] font-bold tracking-widest whitespace-nowrap text-neutral-400/25 select-none">{page.watermark}</span>
										</div>
									)}
									{/* The sheets, behind the text */}
									{paged ? (
										Array.from({ length: pages }, (_, i) => (
											<div key={i} aria-hidden data-sheet={i + 1} className="pointer-events-none absolute right-0 left-0 bg-white bg-[length:100%_100%] shadow-md ring-1 ring-black/10" style={{ top: i * (heightPx + PAGE_GAP), height: heightPx, ...(page.border ? { outline: "1px solid #444", outlineOffset: -18 } : {}), backgroundImage: fileMargins && margins.get(i + 1) ? `url(${margins.get(i + 1)})` : undefined }} />
										))
									) : (
										<div aria-hidden className="pointer-events-none absolute inset-0 bg-white shadow-md ring-1 ring-black/10" />
									)}
									{mode === "edit" &&
										!fileMargins &&
										Array.from({ length: pages }, (_, i) => {
											const top = i * (heightPx + PAGE_GAP);
											return (
												<div key={i} className="pointer-events-none absolute right-0 left-0 z-10 text-[10pt] text-neutral-600" style={{ top, height: heightPx, paddingInline: box.left * PX_PER_PT }}>
													{textFor(hf, "header", i) && (
														<div className="absolute right-0 left-0 flex justify-between gap-4" style={{ top: 0.5 * 72 * PX_PER_PT, paddingInline: box.left * PX_PER_PT }}>
															{zones(textFor(hf, "header", i)).map((z, k) => (
																<span key={k}>{z}</span>
															))}
														</div>
													)}
													{(textFor(hf, "footer", i) || hf.pageNumbers) && (
														<div className="absolute right-0 left-0 flex justify-between" style={{ bottom: 0.5 * 72 * PX_PER_PT, paddingInline: box.left * PX_PER_PT }}>
															{zones(textFor(hf, "footer", i)).map((z, k) => (
																<span key={k}>{z}</span>
															))}
															{hf.pageNumbers && <span>Page {i + 1}</span>}
														</div>
													)}
												</div>
											);
										})}
									<div ref={body} style={columnsCss} className="doc-body relative z-[1]">
										<BlockNoteView editor={editor} theme="light" editable={!readOnly && mode !== "read"} formattingToolbar={false} sideMenu={false} className="bg-transparent" />
									</div>
								</div>
							</div>
							</>
						)}
					</div>
					{!view.focus && comments.panel}
				</div>
				{comments.dialog}
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
			{dialog === "compare" && history && <CompareDialog workspacePath={history.workspacePath} rel={history.rel} lines={() => textOfBlocks(editor.document as never).split(String.fromCharCode(10))} onClose={() => setDialog(null)} />}
			{dialog === "accessibility" && (
				<AccessibilityDialog
					blocks={() => editor.document as unknown as BlockLike[]}
					goTo={(id) => {
						setDialog(null);
						editor.setTextCursorPosition(id, "start");
						editor.focus();
					}}
					onClose={() => setDialog(null)}
				/>
			)}
			{dialog === "notes" && (
				<NotesDialog
					rows={referencesIn(editor.document as never).flatMap((r) => {
						const d = noteMap.get(String(r.id));
						return d ? [{ id: r.id, end: r.end, text: d.text }] : [];
					})}
					readOnly={readOnly}
					onEdit={a.editNote}
					onClose={() => setDialog(null)}
				/>
			)}
			{dialog === "sources" && <SourcesDialog doc={doc} editor={editor} onClose={() => setDialog(null)} />}
			{dialog === "merge" && <MergeDialog editor={editor} workspacePath={history?.workspacePath} onClose={() => setDialog(null)} />}
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
			{dialog === "reload" && (
				<Dialog isOpen onOpenChange={(o) => !o && setDialog(null)} className="max-w-md">
					<div className="space-y-4 text-sm">
						<DialogHeading icon={<RotateCcw className="size-6" />} title="Reload from File" />
						<p>This replaces what the document holds with {name} as the file has it now, for everyone who has it open.</p>
						<DialogFooter>
							<Button variant="outline" onPress={() => setDialog(null)}>
								Cancel
							</Button>
							<Button onPress={() => void reload()}>Reload</Button>
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
				{(["firstHeader", "firstFooter", "evenHeader", "evenFooter"] as const).map((k) => (
					<label key={k} className="block">
						<span className="mb-1 block text-muted-foreground">{k === "firstHeader" ? "First page header (if different)" : k === "firstFooter" ? "First page footer (if different)" : k === "evenHeader" ? "Even pages header (if different)" : "Even pages footer (if different)"}</span>
						<input aria-label={k} value={v[k] ?? ""} onChange={(e) => setV({ ...v, [k]: e.target.value })} maxLength={200} className="h-8 w-full border bg-background px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring" />
					</label>
				))}
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

// Drawn again only when what it is given changes, not with every redraw of the page around it
export default memo(DocumentWorkspace);
