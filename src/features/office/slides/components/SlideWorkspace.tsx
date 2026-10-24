import CollapsiblePane from "@/components/layout/CollapsiblePane";
// A deck open for editing: the title bar, tabs and ribbon of a presentation program around the slide list, the slide and its notes.
// The slides are drawn by the backend from the deck's pieces; the frames over them select, move and resize shapes, and everyone with
// the deck open sees changes as they are made.

import { save } from "@tauri-apps/plugin-dialog";
import { Download, FilePenLine, History, Info, Redo2, Save, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";

import Backstage from "@/features/office/shared/Backstage";
import HistoryPanel from "@/features/office/shared/HistoryPanel";
import { PeopleStack, usePeople } from "@/features/office/shared/People";
import { OfficeFrame, ZoomBar, type RibbonTab } from "@/features/office/shared/Ribbon";
import SlideCanvas, { type OtherSelection } from "@/features/office/slides/components/SlideCanvas";
import SlideRibbon from "@/features/office/slides/components/SlideRibbon";
import Loading from "@/components/Loading";
import { Button } from "@/components/ui/button";
import type { CollabDoc } from "@/hooks/useCollabDoc";
import { colorOf } from "@/lib/collabColor";
import { addShape, addSlide, arrange, deleteSlide, duplicateSlide, getBase, moveSlide, nextShapeId, notesOf, readSlide, readSlides, removeShape, seed, setBase, setShape, setSlideMeta, slideKeys, slideOrder, textOf, transitionOf, type ShapeJson, type SlideJson, type Xfrm } from "@/features/office/slides/lib/deck";
import { deckAddPicture, deckEditShape, deckEditSlide, deckLayouts, deckNewShape, deckNewSlide, deckRegister, deckSave, type ShapeEdit, type SlideEdit } from "@/lib/tauri";
import { useSlideImage } from "@/features/office/slides/lib/useSlideImage";
import { cn, errorText } from "@/lib/utils";

const LOCAL = "local-edit";
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
	const [baseId, setBaseId] = useState<string | null>(null);
	const reregister = useCallback(async () => {
		const base = getBase(doc);
		if (!base) return null;
		const id = await deckRegister(base);
		setBaseId(id);
		return id;
	}, [doc]);
	const baseText = getBase(doc);
	useEffect(() => {
		if (baseText) void reregister().catch((e) => setNotice({ ok: false, text: errorText(e, "The deck could not be read.") }));
	}, [baseText, reregister]);
	const [layouts, setLayouts] = useState<{ id: number; name: string }[]>([]);
	useEffect(() => {
		if (baseId) deckLayouts(baseId).then(setLayouts).catch(() => setLayouts([]));
	}, [baseId]);

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
	const width = Math.round((fit * zoom) / 100);
	const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
	const slideText = slide ? JSON.stringify(slide) : null;
	const { image, error: drawError } = useSlideImage(baseId, slideText, (width / 960) * dpr, reregister);

	// Who has what selected
	const [sel, setSel] = useState<number | null>(null);
	useEffect(() => setSel(null), [key]);
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

	const setBox = (id: number, box: Xfrm) => {
		const s = shapeOf(id);
		if (s && key) edit(() => setShape(doc, key, { ...s, xfrm: { x: box.x, y: box.y, w: box.w, h: box.h, ...(box.rot ? { rot: box.rot } : {}) } }));
	};
	const change = async (id: number, e: ShapeEdit) => {
		const s = shapeOf(id);
		if (!s || !key) return;
		try {
			const next = JSON.parse(await deckEditShape(JSON.stringify(s), e)) as ShapeJson;
			edit(() => setShape(doc, key, next));
		} catch (err) {
			flash(false, errorText(err, "That did not work."));
		}
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
		if (!baseId) return;
		try {
			const s = JSON.parse(await deckNewSlide(baseId, layout)) as SlideJson;
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
			flash(true, `Saved a copy (${Math.max(1, Math.round(size / 1024))} KB).`);
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
	const [typing, setTyping] = useState(false);
	const [view, setViewState] = useState({ notes: true });
	const [notesDraft, setNotesDraft] = useState<string | null>(null);
	useEffect(() => setNotesDraft(null), [key]);

	// Keys of the whole page: slide navigation and undo, when no text is being typed
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (typing || presenting !== null || (e.target as HTMLElement | null)?.closest("input, textarea, select")) return;
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
				e.preventDefault();
				if (e.shiftKey) undo.redo();
				else undo.undo();
			} else if (e.key === "PageDown" && index >= 0 && index < keys.length - 1) setActiveKey(keys[index + 1]);
			else if (e.key === "PageUp" && index > 0) setActiveKey(keys[index - 1]);
			else if (e.key === "F5") {
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
					layouts={layouts}
					hidden={slide.hidden === true}
					transition={transitionOf(slide)}
					newSlide={(l) => void newSlide(l)}
					duplicate={() => edit(() => setActiveKey(duplicateSlide(doc, key)))}
					deleteSlide={() => {
						const problem = deleteSlide(doc, key);
						if (problem) flash(false, problem);
					}}
					moveSlide={(by) => edit(() => moveSlide(doc, key, by))}
					addShape={(k) => void addShapeOfKind(k)}
					pickPicture={() => picker.current?.click()}
					change={(e) => sel !== null && void change(sel, e)}
					arrange={(to) => sel !== null && edit(() => arrange(doc, key, sel, to))}
					deleteShape={() => {
						if (sel === null) return;
						edit(() => removeShape(doc, key, sel));
						setSel(null);
					}}
					setBackground={(hex, all) => void changeSlide({ background: hex }, all)}
					setTransition={(kind, all) => void changeSlide({ transition: kind }, all)}
					setHidden={(h) => void changeSlide({ hidden: h })}
					present={(fromStart) => setPresenting(fromStart ? 0 : Math.max(0, index))}
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
					<ZoomBar value={zoom} onChange={setZoom} min={30} max={200} />
				</>
			}
		>
			<input ref={picker} type="file" accept="image/png,image/jpeg,image/gif" className="hidden" onChange={(e) => { void addPicture(e.target.files?.[0]); e.target.value = ""; }} />
			<div className="flex h-full min-h-0 flex-col">
				{notice && (
					<p role={notice.ok ? "status" : "alert"} className={cn("px-3 py-1.5 text-sm", notice.ok ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive")}>
						{notice.text}
					</p>
				)}
				{opened.notes.length > 0 && <p className="border-b bg-muted/40 px-3 py-1 text-[13px] text-muted-foreground">{opened.notes.join(" ")}</p>}
				<div className="flex min-h-0 flex-1">
					<CollapsiblePane id="slides.thumbs" defaultWidth={176} label="the slide list">
					<ol aria-label="Slides" className="w-44 shrink-0 space-y-2 overflow-y-auto border-r bg-[#f3f2f1] p-2 dark:bg-neutral-800">
						{keys.map((k, i) => (
							<li key={k}>
								<Thumb doc={doc} k={k} baseId={baseId} reregister={reregister} current={k === key} number={i + 1} onPick={() => setActiveKey(k)} version={version} />
							</li>
						))}
					</ol>
					</CollapsiblePane>
					<div className="flex min-w-0 flex-1 flex-col">
						<div ref={stage} className="flex min-h-0 flex-1 items-start justify-center overflow-auto bg-[#e6e6e6] p-6 dark:bg-neutral-900">
							{image ? (
								<SlideCanvas
									image={image}
									displayWidth={width}
									selected={sel}
									others={others.filter((o) => o.key === key)}
									readOnly={readOnly}
									text={(id) => (shapeOf(id) ? textOf(shapeOf(id)!) : "")}
									onSelect={setSel}
									onBox={setBox}
									onDelete={(id) => {
										edit(() => removeShape(doc, key, id));
										setSel(null);
									}}
									onText={(id, text) => void change(id, { text })}
									onEditing={setTyping}
								/>
							) : drawError ? (
								<p role="alert" className="max-w-md bg-destructive/10 p-3 text-sm text-destructive">
									{drawError}
								</p>
							) : (
								<Loading className="h-48" />
							)}
						</div>
						{view.notes && (
							<div className="shrink-0 border-t bg-background">
								<textarea
									aria-label="Speaker notes"
									placeholder="Click to add notes"
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
			{presenting !== null && baseId && (
				<Presenter doc={doc} keys={keys} start={presenting} baseId={baseId} reregister={reregister} onShow={(i) => setActiveKey(keys[i])} onClose={() => setPresenting(null)} />
			)}
		</OfficeFrame>
	);
}

// A small picture of a slide in the list
function Thumb({ doc, k, baseId, reregister, current, number, onPick, version }: { doc: Y.Doc; k: string; baseId: string | null; reregister: () => Promise<string | null>; current: boolean; number: number; onPick: () => void; version: number }) {
	const s = useMemo(() => readSlide(doc, k), [doc, k, version]); // eslint-disable-line react-hooks/exhaustive-deps
	const text = s ? JSON.stringify(s) : null;
	const { image } = useSlideImage(baseId, text, 0.18, reregister, 250);
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

// The full-screen show: the slides at the size of the screen, moved with the arrow keys, space or a click; Escape ends it. Hidden slides are
// skipped, and a slide with a transition fades in.
function Presenter({ doc, keys, start, baseId, reregister, onShow, onClose }: { doc: Y.Doc; keys: string[]; start: number; baseId: string; reregister: () => Promise<string | null>; onShow: (i: number) => void; onClose: () => void }) {
	const shownKeys = useMemo(() => keys.filter((k) => readSlide(doc, k)?.hidden !== true), []); // eslint-disable-line react-hooks/exhaustive-deps
	const list = shownKeys.length > 0 ? shownKeys : keys;
	const [i, setI] = useState(Math.max(0, Math.min(list.length - 1, list.indexOf(keys[start]) >= 0 ? list.indexOf(keys[start]) : 0)));
	const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
	useEffect(() => {
		const on = () => setSize({ w: window.innerWidth, h: window.innerHeight });
		window.addEventListener("resize", on);
		return () => window.removeEventListener("resize", on);
	}, []);
	useEffect(() => onShow(keys.indexOf(list[i])), [i]); // eslint-disable-line react-hooks/exhaustive-deps
	const go = useCallback((n: number) => setI((c) => Math.max(0, Math.min(list.length - 1, c + n))), [list.length]);
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
			else if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(e.key)) go(1);
			else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.key)) go(-1);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [go, onClose]);
	const s = readSlide(doc, list[i]);
	const text = s ? JSON.stringify(s) : null;
	const first = useSlideImage(baseId, text, 1, reregister, 0).image;
	// Drawn at the width that fits the screen, at the pixel density of the display
	const w = first ? Math.min(size.w, (size.h * first.widthPt) / first.heightPt) : size.w;
	const { image } = useSlideImage(baseId, text, (w / (first?.widthPt ?? 960)) * (window.devicePixelRatio || 1), reregister, 0);
	const moves = s ? transitionOf(s) !== "none" : false;
	return (
		<div role="dialog" aria-label="Slide show" className="fixed inset-0 z-50 flex items-center justify-center bg-black" onClick={() => go(1)}>
			{(image ?? first) && <img key={list[i]} src={`data:image/png;base64,${(image ?? first)!.png}`} alt={`Slide ${i + 1} of ${list.length}`} draggable={false} style={{ width: w }} className={cn("select-none", moves && "animate-in fade-in duration-500")} />}
			<span className="pointer-events-none absolute right-3 bottom-2 font-mono text-xs text-white/50">
				{i + 1} / {list.length}
			</span>
			<button type="button" aria-label="End the show" onClick={(e) => { e.stopPropagation(); onClose(); }} className="absolute top-3 right-3 text-white/50 hover:text-white">
				<X className="size-5" />
			</button>
		</div>
	);
}
