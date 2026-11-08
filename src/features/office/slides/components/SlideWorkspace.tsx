import { Notice } from "@/components/ui/notice";
import CollapsiblePane from "@/components/layout/CollapsiblePane";
// A deck open for editing: the title bar, tabs and ribbon of a presentation program around the slide list, the slide and its notes.
// The slides are drawn by the backend from the deck's pieces; the frames over them select, move and resize shapes, and everyone with
// the deck open sees changes as they are made.

import { save } from "@tauri-apps/plugin-dialog";
import { Download, FilePenLine, History, Info, Redo2, Save, Undo2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";

import Backstage from "@/features/office/shared/Backstage";
import HistoryPanel from "@/features/office/shared/HistoryPanel";
import { PeopleStack, usePeople } from "@/features/office/shared/People";
import { OfficeFrame, ZoomBar, type RibbonTab } from "@/features/office/shared/Ribbon";
import SlideCanvas, { type OtherSelection } from "@/features/office/slides/components/SlideCanvas";
import SlideRibbon from "@/features/office/slides/components/SlideRibbon";
import SlideShow from "@/features/office/slides/components/SlideShow";
import SlideSorter from "@/features/office/slides/components/SlideSorter";
import { align as alignBoxes, distribute as distributeBoxes, type AlignTo, type Box } from "@/features/office/slides/lib/arrange";
import { crisp } from "@/features/office/slides/lib/show";
import { readFlag, saveFlag } from "@/lib/storage";
import Loading from "@/components/Loading";
import { Button } from "@/components/ui/button";
import type { CollabDoc } from "@/hooks/useCollabDoc";
import { colorOf } from "@/lib/collabColor";
import { addShape, addSlide, arrange, cloneShape, deleteSlide, duplicateSlide, getBase, moveSlide, nextShapeId, notesOf, readSlide, readSlides, removeShape, runsIn, searchText, seed, setBase, setShape, setSlideMeta, slideKeys, slideOrder, textOf, timingOf, transitionOf, type ShapeJson, type SlideJson, type Xfrm } from "@/features/office/slides/lib/deck";
import { deckAddPicture, deckEditShape, deckEditSlide, deckEditTable, deckGroup, deckNewShape, deckNewTable, deckReplace, deckSave, deckUngroup, type ShapeEdit, type SlideEdit, type TableEdit } from "@/features/office/lib/api";
import { useDeckSession, type DeckSession } from "@/features/office/slides/lib/useDeckSession";
import { useSlideImage } from "@/features/office/slides/lib/useSlideImage";
import { cn, errorText, formatBytes } from "@/lib/utils";

const LOCAL = "local-edit";
const ZOOM_MIN = 30;
const ZOOM_MAX = 300;
const PRESENTER_KEY = "nexsync.slides.presenterView";
const TABS: RibbonTab[] = [
	{ id: "home", label: "Home" },
	{ id: "insert", label: "Insert" },
	{ id: "design", label: "Design" },
	{ id: "transitions", label: "Transitions" },
	{ id: "show", label: "Slide Show" },
	{ id: "view", label: "View" },
];

export interface SlideWorkspaceProps {
	collab: CollabDoc;
	opened: { base: string; slides: string[]; notes: string[] };
	name: string;
	rel: string;
	workspacePath: string;
	readOnly: boolean;
	author: string;
	// A slide to start on (someone presenting is followed this way)
	startAt?: number | null;
	// Told which slide is open (1-based), so the page can say where this person is
	onSlide?: (n: number | undefined) => void;
}

export default function SlideWorkspace({ collab, opened, name, rel, workspacePath, readOnly, author, startAt, onSlide }: SlideWorkspaceProps) {
	const { doc } = collab;
	const [tab, setTab] = useState("home");
	const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
	const flash = (ok: boolean, text: string) => setNotice({ ok, text });
	const people = usePeople(collab.awareness, "pick");

	// Everything that changes in the deck
	const [version, setVersion] = useState(0);
	useEffect(() => {
		const bump = () => setVersion((v) => v + 1);
		doc.on("update", bump);
		return () => doc.off("update", bump);
	}, [doc]);
	useEffect(() => {
		if (collab.synced) seed(doc, opened.base, opened.slides);
	}, [collab.synced, doc, opened]);

	const keys = useMemo(() => slideKeys(doc), [doc, version]); // eslint-disable-line react-hooks/exhaustive-deps
	const [activeKey, setActiveKey] = useState<string | null>(null);
	const key = activeKey && keys.includes(activeKey) ? activeKey : (keys[0] ?? null);
	const index = key ? keys.indexOf(key) : -1;
	const [wanted, setWanted] = useState<number | null>(startAt ?? null);
	useEffect(() => {
		if (wanted && keys.length >= wanted) {
			setActiveKey(keys[wanted - 1]);
			setWanted(null);
		}
	}, [wanted, keys]);
	useEffect(() => onSlide?.(index >= 0 ? index + 1 : undefined), [index, onSlide]);

	const slide = useMemo(() => (key ? readSlide(doc, key) : null), [doc, key, version]); // eslint-disable-line react-hooks/exhaustive-deps

	// The deck's base lives on the backend while it is drawn
	const deck = useDeckSession(doc, (e) => setNotice({ ok: false, text: errorText(e, "The deck could not be read.") }));
	const [layouts, setLayouts] = useState<{ id: number; name: string }[]>([]);
	useEffect(() => {
		if (deck.id) deck.layouts().then(setLayouts).catch(() => setLayouts([]));
	}, [deck]);

	// How wide the slide is drawn: what fits the work area, times the zoom
	const stage = useRef<HTMLDivElement>(null);
	const [fit, setFit] = useState(720);
	const [zoom, setZoom] = useState(100);
	useEffect(() => {
		const el = stage.current;
		if (!el) return;
		const measure = () => setFit(Math.max(240, Math.min(1400, el.clientWidth - 48)));
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	}, [slide === null]);
	// Ctrl and the wheel zoom the slide, as in a browser or a presentation program. A listener of our own, because the page's would be
	// passive and could not stop the whole window from zooming.
	useEffect(() => {
		const el = stage.current;
		if (!el) return;
		const onWheel = (e: WheelEvent) => {
			if (!e.ctrlKey && !e.metaKey) return;
			e.preventDefault();
			setZoom((z) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(z * (e.deltaY < 0 ? 1.1 : 1 / 1.1)))));
		};
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => el.removeEventListener("wheel", onWheel);
	}, [slide === null]);
	const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
	// Drawn at a size whose pixels land one for one on the screen's, so the text is sharp
	const [slideSize, setSlideSize] = useState({ w: 960, h: 540 });
	const drawn = crisp((fit * zoom) / 100, slideSize.w, dpr);
	const width = drawn.width;
	const slideText = slide ? JSON.stringify(slide) : null;
	const { image, error: drawError } = useSlideImage(deck, slideText, drawn.scale);
	useEffect(() => {
		if (image && (image.widthPt !== slideSize.w || image.heightPt !== slideSize.h)) setSlideSize({ w: image.widthPt, h: image.heightPt });
	}, [image, slideSize]);

	// Who has what selected
	// The shapes chosen on this slide; the last is the one the ribbon and the handles go with
	const [picked, setPicked] = useState<number[]>([]);
	const sel = picked.length > 0 ? picked[picked.length - 1] : null;
	const setSel = (id: number | null) => setPicked(id === null ? [] : [id]);
	// A shape to choose once the slide it is on is open (a search finds it there)
	const pendingSel = useRef<number | null>(null);
	useEffect(() => {
		setPicked(pendingSel.current !== null ? [pendingSel.current] : []);
		pendingSel.current = null;
	}, [key]);
	// Where the text being typed is selected, so a look applies to those words only
	const range = useRef<{ id: number; start: number; end: number; value: string } | null>(null);
	const [others, setOthers] = useState<(OtherSelection & { key: string })[]>([]);
	useEffect(() => {
		if (!key) return;
		const aw = collab.awareness;
		aw.setLocalStateField("pick", { key, id: sel, name: author, color: colorOf(author) });
		const read = () => {
			const out: (OtherSelection & { key: string })[] = [];
			aw.getStates().forEach((st, client) => {
				const p = st.pick as { key: string; id: number | null; name: string; color: string } | undefined;
				if (client !== aw.clientID && p && p.id !== null) out.push({ key: p.key, id: p.id, name: p.name, color: p.color });
			});
			setOthers(out);
		};
		aw.on("change", read);
		read();
		return () => aw.off("change", read);
	}, [collab, key, sel, author]);

	const undo = useMemo(() => new Y.UndoManager([slideOrder(doc)], { trackedOrigins: new Set([LOCAL]) }), [doc]);
	useEffect(() => {
		if (key) undo.addToScope([doc.getMap(`slide:${key}`), doc.getArray(`shapes:${key}`)]);
	}, [undo, doc, key]);

	const edit = (fn: () => void) => doc.transact(fn, LOCAL);
	const shapeOf = (id: number): ShapeJson | undefined => slide?.shapes.find((s) => s.id === id);
	const selectedShape = sel !== null ? shapeOf(sel) : undefined;
	const hasText = selectedShape?.text !== undefined && selectedShape?.text !== null;

	const frameOf = (id: number) => image?.frames.find((f) => f.id === id);
	const place = (id: number, box: Xfrm) => {
		const s = shapeOf(id);
		if (s && key) setShape(doc, key, { ...s, xfrm: { x: box.x, y: box.y, w: box.w, h: box.h, ...(box.rot ? { rot: box.rot } : {}) } });
	};
	// A move of one of several chosen shapes moves them all
	const setBox = (id: number, box: Xfrm) => {
		const f = frameOf(id);
		edit(() => {
			place(id, box);
			if (!f || picked.length < 2 || !picked.includes(id) || box.w !== f.w || box.h !== f.h) return;
			for (const o of picked) {
				const g = frameOf(o);
				if (o !== id && g) place(o, { x: g.x + box.x - f.x, y: g.y + box.y - f.y, w: g.w, h: g.h, rot: g.rot });
			}
		});
	};
	const change = async (id: number, e: ShapeEdit) => {
		const s = shapeOf(id);
		if (!s || !key) return;
		try {
			let sent = e;
			const r = range.current;
			// Words selected in the text being typed: the look goes to them, and the typed text goes along
			if (r && r.id === id && e.text === undefined) sent = { ...e, range: [r.start, r.end], ...(typing && r.value !== textOf(s) ? { text: r.value } : {}) };
			const next = JSON.parse(await deckEditShape(JSON.stringify(s), sent)) as ShapeJson;
			edit(() => setShape(doc, key, next));
		} catch (err) {
			flash(false, errorText(err, "That did not work."));
		}
	};
	// Bold, italic and underline switch off when everything they apply to has them on
	const toggled = (e: ShapeEdit): ShapeEdit => {
		if (!selectedShape) return e;
		const r = range.current;
		const runs = runsIn(selectedShape, r && r.id === selectedShape.id && r.start < r.end ? [r.start, r.end] : null);
		if (runs.length === 0) return e;
		return {
			...e,
			...(e.bold && runs.every((x) => x.bold) ? { bold: false } : {}),
			...(e.italic && runs.every((x) => x.italic) ? { italic: false } : {}),
			...(e.underline && runs.every((x) => x.underline && x.underline !== "none") ? { underline: false } : {}),
		};
	};

	// Copying, cutting and pasting shapes
	const clip = useRef<ShapeJson[]>([]);
	const [clipCount, setClipCount] = useState(0);
	const chosen = (): ShapeJson[] =>
		picked.flatMap((id) => {
			const s = shapeOf(id);
			const f = frameOf(id);
			// A placeholder takes its place from the layout: the copy needs the place it has
			return s ? [s.xfrm || !f ? s : { ...s, xfrm: { x: f.x, y: f.y, w: f.w, h: f.h } }] : [];
		});
	const pasteShapes = (list: ShapeJson[]) => {
		if (!slide || !key || list.length === 0 || readOnly) return;
		let n = nextShapeId(slide) - 1;
		const made = list.map((s) => cloneShape(s, () => ++n, 12, 12));
		edit(() => made.forEach((m) => addShape(doc, key, m)));
		setPicked(made.map((m) => m.id));
	};
	const copy = () => {
		const list = chosen();
		if (list.length === 0) return;
		clip.current = list;
		setClipCount(list.length);
	};
	const removePicked = () => {
		if (!key) return;
		edit(() => picked.forEach((id) => removeShape(doc, key, id)));
		setSel(null);
	};

	// Lining up, grouping and turning
	const boxes = (): Box[] => picked.flatMap((id) => frameOf(id) ?? []).map((f) => ({ id: f.id, x: f.x, y: f.y, w: f.w, h: f.h }));
	const applyBoxes = (list: Box[]) => edit(() => list.forEach((b) => place(b.id, { x: b.x, y: b.y, w: b.w, h: b.h, rot: frameOf(b.id)?.rot })));
	const alignTo = (how: AlignTo) => applyBoxes(alignBoxes(boxes(), how, slideSize));
	const distribute = (axis: "h" | "v") => applyBoxes(distributeBoxes(boxes(), axis));
	const rotate = (by: number | "reset") =>
		edit(() =>
			picked.forEach((id) => {
				const f = frameOf(id);
				if (f) place(id, { x: f.x, y: f.y, w: f.w, h: f.h, rot: by === "reset" ? 0 : (((f.rot + by) % 360) + 360) % 360 });
			}),
		);
	const group = async () => {
		if (!slide || !key || picked.length < 2) return;
		try {
			const id = nextShapeId(slide);
			const g = JSON.parse(await deckGroup(chosen().map((s) => JSON.stringify(s)), id)) as ShapeJson;
			edit(() => {
				picked.forEach((i) => removeShape(doc, key, i));
				addShape(doc, key, g);
			});
			setSel(id);
		} catch (err) {
			flash(false, errorText(err, "The shapes could not be grouped."));
		}
	};
	const ungroup = async () => {
		if (!key || !selectedShape) return;
		try {
			const list = (await deckUngroup(JSON.stringify(selectedShape))).map((j) => JSON.parse(j) as ShapeJson);
			edit(() => {
				removeShape(doc, key, selectedShape.id);
				list.forEach((s) => addShape(doc, key, s));
			});
			setPicked(list.map((s) => s.id));
		} catch (err) {
			flash(false, errorText(err, "The group could not be taken apart."));
		}
	};

	// Tables
	const kindOf = (s?: ShapeJson) => (s?.kind as { type?: string } | undefined)?.type;
	const tableCells = kindOf(selectedShape) === "table" ? ((selectedShape!.kind as { rows: { cells: { text?: ShapeJson["text"] }[] }[] }).rows.map((r) => r.cells.map((c) => textOf({ id: 0, text: c.text })))) : null;
	const addTable = async (rows: number, cols: number) => {
		if (!slide || !key) return;
		try {
			const id = nextShapeId(slide);
			const w = slideSize.w * 0.7;
			const h = Math.min(rows * 36, slideSize.h * 0.7);
			const shape = JSON.parse(await deckNewTable(id, rows, cols, (slideSize.w - w) / 2, 140, w, h)) as ShapeJson;
			edit(() => addShape(doc, key, shape));
			setSel(id);
			setTab("home");
		} catch (err) {
			flash(false, errorText(err, "The table could not be added."));
		}
	};
	const editTable = async (e: TableEdit) => {
		if (!selectedShape || !key) return;
		try {
			const next = JSON.parse(await deckEditTable(JSON.stringify(selectedShape), e)) as ShapeJson;
			edit(() => setShape(doc, key, next));
		} catch (err) {
			flash(false, errorText(err, "That did not work."));
		}
	};

	// Moving the slide to another layout: its placeholders follow the new layout and the ones it lacked are added
	const changeLayout = async (layout: number) => {
		if (!deck.id || !slide || !key) return;
		try {
			const next = JSON.parse(await deck.applyLayout(JSON.stringify(slide), layout, nextShapeId(slide))) as SlideJson;
			const had = new Set(slide.shapes.map((s) => s.id));
			edit(() => {
				setSlideMeta(doc, key, next);
				next.shapes.forEach((s) => (had.has(s.id) ? setShape(doc, key, s) : addShape(doc, key, s)));
			});
		} catch (err) {
			flash(false, errorText(err, "The layout could not be changed."));
		}
	};

	// Find and replace across the slides, in text and in table cells
	const hits = (s: ShapeJson, q: string, matchCase: boolean) => (matchCase ? searchText(s).includes(q) : searchText(s).toLowerCase().includes(q.toLowerCase()));
	const findNext = async (q: string, matchCase: boolean) => {
		const all = keys.flatMap((k) => (readSlide(doc, k)?.shapes ?? []).map((s) => ({ k, s })));
		const at = all.findIndex((x) => x.k === key && x.s.id === sel);
		const start = at >= 0 ? at + 1 : Math.max(0, all.findIndex((x) => x.k === key));
		for (let i = 0; i < all.length; i++) {
			const x = all[(start + i) % all.length];
			if (!hits(x.s, q, matchCase)) continue;
			range.current = null;
			if (x.k === key) setSel(x.s.id);
			else {
				pendingSel.current = x.s.id;
				setActiveKey(x.k);
			}
			return true;
		}
		return false;
	};
	const replaceOne = async (q: string, r: string, matchCase: boolean) => {
		if (!selectedShape || !key || !hits(selectedShape, q, matchCase)) return findNext(q, matchCase);
		try {
			const [json] = await deckReplace(JSON.stringify(selectedShape), q, r, matchCase, true);
			range.current = null;
			edit(() => setShape(doc, key, JSON.parse(json) as ShapeJson));
			await findNext(q, matchCase);
			return true;
		} catch (err) {
			flash(false, errorText(err, "That could not be replaced."));
			return false;
		}
	};
	const replaceAll = async (q: string, r: string, matchCase: boolean) => {
		let total = 0;
		try {
			for (const k of keys) {
				for (const s of readSlide(doc, k)?.shapes ?? []) {
					if (!hits(s, q, matchCase)) continue;
					const [json, n] = await deckReplace(JSON.stringify(s), q, r, matchCase, false);
					if (n > 0) edit(() => setShape(doc, k, JSON.parse(json) as ShapeJson));
					total += n;
				}
			}
			range.current = null;
		} catch (err) {
			flash(false, errorText(err, "That could not be replaced."));
		}
		return total;
	};

	// A change to a slide's own settings, for this slide or for all of them
	const changeSlide = async (e: SlideEdit, all = false) => {
		try {
			for (const k of all ? keys : key ? [key] : []) {
				const s = readSlide(doc, k);
				if (!s) continue;
				const next = JSON.parse(await deckEditSlide(JSON.stringify({ ...s, shapes: [] }), e)) as SlideJson;
				edit(() => setSlideMeta(doc, k, next));
			}
		} catch (err) {
			flash(false, errorText(err, "That did not work."));
		}
	};

	const addShapeOfKind = async (kind: string) => {
		if (!slide || !key) return;
		try {
			const id = nextShapeId(slide);
			const shape = JSON.parse(await deckNewShape(kind, id, 120, 140, kind === "textBox" ? 360 : 240, kind === "textBox" ? 80 : 160)) as ShapeJson;
			edit(() => addShape(doc, key, shape));
			setSel(id);
			setTab("home");
		} catch (err) {
			flash(false, errorText(err, "The shape could not be added."));
		}
	};

	const picker = useRef<HTMLInputElement>(null);
	const addPicture = async (file: File | undefined) => {
		const base = getBase(doc);
		if (!file || !slide || !key || !base) return;
		try {
			const dataUrl = await new Promise<string>((ok, bad) => {
				const r = new FileReader();
				r.onload = () => ok(String(r.result));
				r.onerror = () => bad(new Error("That picture could not be read."));
				r.readAsDataURL(file);
			});
			const size = await new Promise<{ w: number; h: number }>((ok, bad) => {
				const i = new Image();
				i.onload = () => ok({ w: i.naturalWidth || 400, h: i.naturalHeight || 300 });
				i.onerror = () => bad(new Error("That is not a picture the browser can show."));
				i.src = dataUrl;
			});
			const slideW = image?.widthPt ?? 960;
			const slideH = image?.heightPt ?? 540;
			const scale = Math.min((slideW * 0.6) / size.w, (slideH * 0.6) / size.h, 1);
			const w = size.w * scale;
			const h = size.h * scale;
			const id = nextShapeId(slide);
			const [nextBase, shapeText] = await deckAddPicture(base, file.name, dataUrl.slice(dataUrl.indexOf(",") + 1), id, (slideW - w) / 2, (slideH - h) / 2, w, h);
			edit(() => {
				setBase(doc, nextBase);
				addShape(doc, key, JSON.parse(shapeText) as ShapeJson);
			});
			setSel(id);
			setTab("home");
		} catch (err) {
			flash(false, errorText(err, "The picture could not be added."));
		}
	};

	const newSlide = async (layout: number) => {
		if (!deck.id) return;
		try {
			const s = JSON.parse(await deck.newSlide(layout)) as SlideJson;
			edit(() => setActiveKey(addSlide(doc, s, key ?? undefined)));
		} catch (err) {
			flash(false, errorText(err, "The slide could not be added."));
		}
	};

	const saveCopy = async () => {
		const base = getBase(doc);
		if (!base) return;
		try {
			const stem = (rel.split("/").pop() ?? "deck").replace(/\.[^.]+$/, "");
			const dest = await save({ title: "Save a copy", defaultPath: `${stem}.pptx`, filters: [{ name: "PowerPoint", extensions: ["pptx"] }] });
			if (!dest) return;
			const size = await deckSave(workspacePath, dest, base, readSlides(doc));
			flash(true, `Saved a copy (${formatBytes(size)}).`);
		} catch (err) {
			flash(false, errorText(err, "The copy could not be saved."));
		}
	};
	const [confirmUpdate, setConfirmUpdate] = useState(false);
	const canUpdate = /\.pptx$/i.test(rel);
	const updateFile = async () => {
		const base = getBase(doc);
		if (!base) return;
		try {
			await deckSave(workspacePath, `${workspacePath.replace(/[\\/]+$/, "")}/${rel}`, base, readSlides(doc));
			setConfirmUpdate(false);
			flash(true, "The file now matches the deck.");
			setTab("home");
		} catch (err) {
			flash(false, errorText(err, "The file could not be updated."));
		}
	};

	const [presenting, setPresenting] = useState<number | null>(null);
	// Whether a show opens a second window for the audience and keeps this one for the presenter; on unless it was turned off
	const [presenterView, setPresenterViewState] = useState(() => !(readFlag(PRESENTER_KEY, true) === false));
	const setPresenterView = (on: boolean) => {
		saveFlag(PRESENTER_KEY, on);
		setPresenterViewState(on);
	};
	const [typing, setTyping] = useState(false);
	const readOnlyRef = useRef(readOnly);
	readOnlyRef.current = readOnly;
	const [view, setViewState] = useState({ notes: true, sorter: false });
	const [notesDraft, setNotesDraft] = useState<string | null>(null);
	useEffect(() => setNotesDraft(null), [key]);

	// What the keys of the page do with the shapes, as they stand right now
	const shapeKeys = useRef<Record<string, () => void>>({});
	shapeKeys.current = { c: copy, x: () => (copy(), removePicked()), v: () => pasteShapes(clip.current), d: () => pasteShapes(chosen()), g: () => void group(), G: () => void ungroup() };
	// Keys of the whole page: slide navigation and undo, when no text is being typed
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (typing || presenting !== null || (e.target as HTMLElement | null)?.closest("input, textarea, select")) return;
			const chord = (e.ctrlKey || e.metaKey) && !e.altKey ? (e.shiftKey && e.key.toLowerCase() === "g" ? "G" : e.shiftKey ? "" : e.key.toLowerCase()) : "";
			if (chord && shapeKeys.current[chord]) {
				e.preventDefault();
				if (chord === "c" || !readOnlyRef.current) shapeKeys.current[chord]();
			} else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
				e.preventDefault();
				if (e.shiftKey) undo.redo();
				else undo.undo();
			} else if (e.key === "PageDown" && index >= 0 && index < keys.length - 1) setActiveKey(keys[index + 1]);
			else if (e.key === "PageUp" && index > 0) setActiveKey(keys[index - 1]);
			else if ((e.ctrlKey || e.metaKey) && (e.key === "=" || e.key === "+")) {
					e.preventDefault();
					setZoom((z) => Math.min(ZOOM_MAX, z + 10));
				} else if ((e.ctrlKey || e.metaKey) && e.key === "-") {
					e.preventDefault();
					setZoom((z) => Math.max(ZOOM_MIN, z - 10));
				} else if ((e.ctrlKey || e.metaKey) && e.key === "0") {
					e.preventDefault();
					setZoom(100);
				} else if (e.key === "F5") {
				e.preventDefault();
				setPresenting(e.shiftKey ? Math.max(0, index) : 0);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [typing, presenting, undo, index, keys]);

	const quickBtn = "flex size-7 items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
	if (!slide || !key) return <Loading className="h-48" />;

	return (
		<OfficeFrame
			accent="powerpoint"
			name={name}
			state={readOnly ? "Read-only" : "Shared"}
			tabs={TABS}
			tab={tab}
			onTab={setTab}
			quick={
				<>
					<button type="button" aria-label="Save a copy" title="Save a copy" onClick={() => setTab("file")} className={quickBtn}>
						<Save className="size-4" />
					</button>
					<button type="button" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={readOnly} onClick={() => undo.undo()} className={quickBtn}>
						<Undo2 className="size-4" />
					</button>
					<button type="button" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={readOnly} onClick={() => undo.redo()} className={quickBtn}>
						<Redo2 className="size-4" />
					</button>
				</>
			}
			people={<PeopleStack people={people} />}
			ribbon={
					<SlideRibbon
						tab={tab}
						readOnly={readOnly}
						hasSelection={!!selectedShape}
						hasText={hasText}
						selectionCount={picked.length}
						isGroup={kindOf(selectedShape) === "group"}
						isTable={tableCells !== null}
						tableCells={tableCells}
						hasClipboard={clipCount > 0}
						layouts={layouts}
						layout={Number(slide.layout)}
						hidden={slide.hidden === true}
						transition={transitionOf(slide)}
						timing={timingOf(slide)}
						newSlide={(l) => void newSlide(l)}
						changeLayout={(l) => void changeLayout(l)}
						duplicate={() => edit(() => setActiveKey(duplicateSlide(doc, key)))}
						deleteSlide={() => {
							const problem = deleteSlide(doc, key);
							if (problem) flash(false, problem);
						}}
						moveSlide={(by) => edit(() => moveSlide(doc, key, by))}
						addShape={(k) => void addShapeOfKind(k)}
						addTable={(r, c) => void addTable(r, c)}
						editTable={(e) => void editTable(e)}
						pickPicture={() => picker.current?.click()}
						change={(e) => sel !== null && void change(sel, toggled(e))}
						arrange={(to) => sel !== null && edit(() => picked.forEach((id) => arrange(doc, key, id, to)))}
						align={alignTo}
						distribute={distribute}
						group={() => void group()}
						ungroup={() => void ungroup()}
						rotate={rotate}
						copy={copy}
						cut={() => (copy(), removePicked())}
						paste={() => pasteShapes(clip.current)}
						duplicateShape={() => pasteShapes(chosen())}
						deleteShape={removePicked}
						find={findNext}
						replaceOne={replaceOne}
						replaceAll={replaceAll}
						setBackground={(hex, all) => void changeSlide({ background: hex }, all)}
						setTransition={(kind, all) => void changeSlide({ transition: kind }, all)}
						setTiming={(e, all) => void changeSlide(e, all)}
						setHidden={(h) => void changeSlide({ hidden: h })}
						present={(fromStart) => setPresenting(fromStart ? 0 : Math.max(0, index))}
						presenterView={presenterView}
						setPresenterView={setPresenterView}
						view={view}
						setView={(v) => setViewState((cur) => ({ ...cur, ...v }))}
					/>
				}
			file={
				<Backstage
					accent="#B7472A"
					onBack={() => setTab("home")}
					items={[
						{
							id: "info",
							label: "Info",
							icon: Info,
							panel: (
								<div className="max-w-md space-y-2 text-sm">
									<h2 className="mb-3 text-2xl font-light">{name}</h2>
									<p>
										{keys.length} {keys.length === 1 ? "slide" : "slides"}.
									</p>
									{opened.notes.map((n) => (
										<p key={n} className="text-muted-foreground">{n}</p>
									))}
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
									<p className="mb-3 text-sm text-muted-foreground">A copy goes where you choose and does not change the file in the workspace.</p>
									<button type="button" onClick={() => void saveCopy()} className="block w-full border px-4 py-3 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
										PowerPoint Presentation (.pptx)
									</button>
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
									<p>Replaces <b>{name}</b> in the workspace with what the deck holds now. Everyone gets the new file.</p>
									{confirmUpdate ? (
										<div className="flex gap-2">
											<Button isDisabled={readOnly || !canUpdate} onPress={() => void updateFile()}>Replace It</Button>
											<Button variant="outline" onPress={() => setConfirmUpdate(false)}>Cancel</Button>
										</div>
									) : (
										<Button isDisabled={!canUpdate || readOnly} onPress={() => setConfirmUpdate(true)}>Replace the File…</Button>
									)}
									{!canUpdate && <p className="text-xs text-muted-foreground">Only .pptx files can be replaced; save a copy to keep the others.</p>}
								</div>
							),
						},
						{ id: "close", label: "Close", icon: X, panel: <p className="text-sm text-muted-foreground">Choose a tab to go back to the slides. Closing is done from the list of decks.</p> },
						{ id: "history", label: "Version History", icon: History, panel: <HistoryPanel workspacePath={workspacePath} rel={rel} readOnly={readOnly} /> },
					]}
				/>
			}
			status={
				<>
					<span>
						Slide {index + 1} of {keys.length}
					</span>
					<button type="button" onClick={() => setViewState((v) => ({ ...v, notes: !v.notes }))} className="outline-none hover:underline focus-visible:ring-1 focus-visible:ring-ring">
						Notes
					</button>
					<ZoomBar value={zoom} onChange={setZoom} min={ZOOM_MIN} max={ZOOM_MAX} />
				</>
			}
		>
			<input ref={picker} type="file" accept="image/png,image/jpeg,image/gif" className="hidden" onChange={(e) => { void addPicture(e.target.files?.[0]); e.target.value = ""; }} />
			<div className="flex h-full min-h-0 flex-col">
				{notice && (
					<Notice tone={notice.ok ? "success" : "error"} className="px-3 py-1.5">
						{notice.text}
					</Notice>
				)}
				{opened.notes.length > 0 && <p className="border-b bg-muted/40 px-3 py-1 text-[13px] text-muted-foreground">{opened.notes.join(" ")}</p>}
					<div className="flex min-h-0 flex-1">
					{view.sorter && (
						<SlideSorter
							doc={doc}
							keys={keys}
							current={key}
							deck={deck}
							version={version}
							readOnly={readOnly}
							onPick={setActiveKey}
							onOpen={(k) => {
								setActiveKey(k);
								setViewState((cur) => ({ ...cur, sorter: false }));
							}}
							onMove={(k, to) => edit(() => moveSlide(doc, k, to - keys.indexOf(k)))}
						/>
					)}
					<div className={cn("flex min-h-0 min-w-0 flex-1", view.sorter && "hidden")}>
					<CollapsiblePane id="slides.thumbs" defaultWidth={176} label="the slide list">
					<ol aria-label="Slides" className="w-44 shrink-0 space-y-2 overflow-y-auto bg-[#f3f2f1] p-2 dark:bg-neutral-800">
						{keys.map((k, i) => (
							<li key={k}>
								<Thumb doc={doc} k={k} deck={deck} current={k === key} number={i + 1} onPick={() => setActiveKey(k)} version={version} />
							</li>
						))}
					</ol>
					</CollapsiblePane>
					<div className="flex min-w-0 flex-1 flex-col">
						<div ref={stage} className="flex min-h-0 flex-1 overflow-auto bg-[#e6e6e6] p-6 dark:bg-neutral-900"><div className="m-auto">
							{image ? (
								<SlideCanvas
									image={image}
									displayWidth={width}
									selected={sel}
									others={others.filter((o) => o.key === key)}
									readOnly={readOnly}
									text={(id) => (shapeOf(id) ? textOf(shapeOf(id)!) : "")}
									also={picked.slice(0, -1)}
									onSelect={(id) => {
										range.current = null;
										// Pressing one of several chosen shapes keeps them chosen, so they can be moved together
										setPicked((cur) => (id === null ? [] : cur.length > 1 && cur.includes(id) ? [...cur.filter((x) => x !== id), id] : [id]));
									}}
									onToggle={(id) => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))}
									onBox={setBox}
									onDelete={(id) => {
										edit(() => (picked.includes(id) ? picked : [id]).forEach((i) => removeShape(doc, key, i)));
										setSel(null);
									}}
									onText={(id, text) => void change(id, { text })}
									onEditing={(on) => {
										if (on) range.current = null;
										setTyping(on);
									}}
									onTextSelect={(t) => {
										// The caret counts characters, not UTF-16 units as the text box does
										const at = (n: number) => [...t.value.slice(0, n)].length;
										range.current = { id: t.id, start: at(t.start), end: at(t.end), value: t.value };
									}}
								/>
							) : drawError ? (
								<Notice className="max-w-md p-3">
									{drawError}
								</Notice>
							) : (
								<Loading className="h-48" />
							)}
							</div>
						</div>
						{view.notes && (
							<div className="shrink-0 border-t bg-background">
								<textarea
									aria-label="Speaker notes"
									placeholder="Notes"
									readOnly={readOnly}
									value={notesDraft ?? notesOf(slide)}
									onChange={(e) => setNotesDraft(e.target.value)}
									onBlur={() => {
										if (notesDraft !== null && notesDraft !== notesOf(slide)) void changeSlide({ notes: notesDraft });
										setNotesDraft(null);
									}}
									className="block h-24 w-full resize-y bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
								/>
							</div>
						)}
					</div>
					</div>
				</div>
			</div>
			{presenting !== null && deck.id && (
				<SlideShow doc={doc} keys={keys} start={presenting} deck={deck} presenterView={presenterView} slideSize={slideSize} onShow={(i) => setActiveKey(keys[i])} onClose={() => setPresenting(null)} />
			)}
		</OfficeFrame>
	);
}

// A small picture of a slide in the list
function Thumb({ doc, k, deck, current, number, onPick, version }: { doc: Y.Doc; k: string; deck: DeckSession; current: boolean; number: number; onPick: () => void; version: number }) {
	const s = useMemo(() => readSlide(doc, k), [doc, k, version]); // eslint-disable-line react-hooks/exhaustive-deps
	const text = s ? JSON.stringify(s) : null;
	const { image } = useSlideImage(deck, text, 0.18, 250);
	return (
		<button type="button" onClick={onPick} aria-current={current} aria-label={`Slide ${number}`} className="block w-full outline-none focus-visible:ring-2 focus-visible:ring-[var(--office)]">
			<span className="flex items-start gap-1.5">
				<span className={cn("w-4 shrink-0 text-right text-[11px]", current ? "font-semibold text-[var(--office)]" : "text-muted-foreground")}>{number}</span>
				<span className={cn("relative block flex-1 bg-white", current ? "ring-2 ring-[var(--office)]" : "ring-1 ring-border", s?.hidden === true && "opacity-50")} style={{ aspectRatio: "16 / 9" }}>
					{image && <img src={`data:image/png;base64,${image.png}`} alt="" draggable={false} className="h-full w-full" />}
					{s?.hidden === true && <span className="absolute right-0.5 bottom-0.5 rounded-sm bg-black/60 px-1 text-[9px] text-white">Hidden</span>}
				</span>
			</span>
		</button>
	);
}
