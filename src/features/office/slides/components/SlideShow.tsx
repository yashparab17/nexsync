// The slide show. The window goes full screen (which also takes away the taskbar), the slide is drawn at the size of the screen one slide
// pixel to one screen pixel, and arrow keys, space or a click move through it; Escape ends it. Hidden slides are skipped.
//
// With the presenter view on, a second window opens for the audience (on the other screen when there is one, and as an ordinary window
// to drag onto the projector when there is not), and this window becomes the presenter's: this slide, the next one, the notes and a
// timer. B and W put up a black or white screen for the audience; typing a slide number and Enter jumps to it.

import { emit, listen } from "@tauri-apps/api/event";
import { PhysicalPosition, availableMonitors, currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { ChevronLeft, ChevronRight, Minus, Monitor, Plus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";

import { Button } from "@/components/ui/button";
import { notesOf, readSlide, transitionOf } from "@/features/office/slides/lib/deck";
import { AUDIENCE_LABEL, SHOW_END, SHOW_NAV, SHOW_READY, SHOW_STATE, clock, crisp, fitSlide, pickAudienceMonitor, type ShowNav, type ShowState } from "@/features/office/slides/lib/show";
import { useSlideImage } from "@/features/office/slides/lib/useSlideImage";
import { cn } from "@/lib/utils";

interface SlideShowProps {
	doc: Y.Doc;
	keys: string[];
	// Index in `keys` of the slide to start on
	start: number;
	baseId: string;
	reregister: () => Promise<string | null>;
	// Show the presenter view here and the slide alone in a second window
	presenterView: boolean;
	// The size of a slide in points, as the deck was last drawn
	slideSize: { w: number; h: number };
	onShow: (i: number) => void;
	onClose: () => void;
}

const useBox = () => {
	const ref = useRef<HTMLDivElement>(null);
	const [size, setSize] = useState({ w: 0, h: 0 });
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	}, []);
	return { ref, size };
};

// A slide drawn to fill a box
function Fitted({ doc, k, baseId, reregister, box, slideSize, className }: { doc: Y.Doc; k: string | null; baseId: string; reregister: () => Promise<string | null>; box: { w: number; h: number }; slideSize: { w: number; h: number }; className?: string }) {
	const slide = useMemo(() => (k ? readSlide(doc, k) : null), [doc, k]);
	const text = slide ? JSON.stringify(slide) : null;
	const dpr = window.devicePixelRatio || 1;
	const { scale, width } = crisp(fitSlide(box, slideSize.w, slideSize.h), slideSize.w, dpr);
	const { image } = useSlideImage(box.w > 0 ? baseId : null, text, scale, reregister, 0);
	return image ? <img src={`data:image/png;base64,${image.png}`} alt="" draggable={false} style={{ width }} className={cn("select-none", className)} /> : null;
}

export default function SlideShow({ doc, keys, start, baseId, reregister, presenterView, slideSize, onShow, onClose }: SlideShowProps) {
	const shown = useMemo(() => keys.filter((k) => readSlide(doc, k)?.hidden !== true), []); // eslint-disable-line react-hooks/exhaustive-deps
	const list = shown.length > 0 ? shown : keys;
	const [i, setI] = useState(() => Math.max(0, Math.min(list.length - 1, list.indexOf(keys[start]) >= 0 ? list.indexOf(keys[start]) : 0)));
	const [cover, setCover] = useState<"black" | "white" | null>(null);
	const [audience, setAudience] = useState<"opening" | "open" | "failed">(presenterView ? "opening" : "failed");
	const [typed, setTyped] = useState("");
	const [noteSize, setNoteSize] = useState(22);
	const [now, setNow] = useState(Date.now());
	const began = useRef(Date.now());
	const go = useCallback((n: number) => setI((c) => Math.max(0, Math.min(list.length - 1, c + n))), [list.length]);
	const key = list[i];
	const slide = readSlide(doc, key);
	const slideJson = slide ? JSON.stringify(slide) : null;
	const moves = slide ? transitionOf(slide) !== "none" : false;

	useEffect(() => onShow(keys.indexOf(key)), [key]); // eslint-disable-line react-hooks/exhaustive-deps

	// Full screen, which also hides the taskbar; put back when the show ends
	useEffect(() => {
		const win = getCurrentWindow();
		void win.setFullscreen(true).catch(() => {});
		return () => void win.setFullscreen(false).catch(() => {});
	}, []);

	// The audience's window
	useEffect(() => {
		if (!presenterView) return;
		let win: WebviewWindow;
		let live = true;
		void (async () => {
			try {
				const target = pickAudienceMonitor(await availableMonitors(), await currentMonitor());
				win = new WebviewWindow(AUDIENCE_LABEL, { url: "index.html?audience=1", title: "Nexsync slide show", width: 960, height: 540, center: true, decorations: !target, focus: false });
				await new Promise<void>((ok, bad) => {
					void win.once("tauri://created", () => ok());
					void win.once("tauri://error", (e) => bad(new Error(String(e.payload))));
				});
				if (target) {
					await win.setPosition(new PhysicalPosition(target.position.x + 40, target.position.y + 40));
					await win.setFullscreen(true);
				}
				if (live) setAudience("open");
			} catch {
				if (live) setAudience("failed");
			}
		})();
		return () => {
			live = false;
			void WebviewWindow.getByLabel(AUDIENCE_LABEL).then((w) => w?.close()).catch(() => {});
		};
	}, [presenterView]);

	// What the audience's window shows follows this one; it asks for the state when it opens
	const stateRef = useRef<ShowState | null>(null);
	useEffect(() => {
		if (!presenterView || !slideJson) return;
		const state: ShowState = { baseId, slide: slideJson, index: i, total: list.length, widthPt: slideSize.w, heightPt: slideSize.h, cover, moves };
		stateRef.current = state;
		void emit(SHOW_STATE, state).catch(() => {});
	}, [presenterView, baseId, slideJson, i, list.length, slideSize.w, slideSize.h, cover, moves]);
	useEffect(() => {
		if (!presenterView) return;
		const offs: (() => void)[] = [];
		void listen(SHOW_READY, () => stateRef.current && void emit(SHOW_STATE, stateRef.current)).then((f) => offs.push(f));
		void listen<ShowNav>(SHOW_NAV, (e) => {
			if (e.payload.by) go(e.payload.by);
			if (e.payload.to !== undefined) setI(Math.max(0, Math.min(list.length - 1, e.payload.to)));
			if ("cover" in e.payload) setCover((c) => (c === e.payload.cover ? null : (e.payload.cover ?? null)));
		}).then((f) => offs.push(f));
		void listen(SHOW_END, onClose).then((f) => offs.push(f));
		return () => offs.forEach((f) => f());
	}, [presenterView, go, list.length, onClose]);

	useEffect(() => {
		const t = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(t);
	}, []);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
			else if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(e.key)) {
				e.preventDefault();
				setCover(null);
				go(1);
			} else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.key)) {
				e.preventDefault();
				setCover(null);
				go(-1);
			} else if (e.key === "Home") setI(0);
			else if (e.key === "End") setI(list.length - 1);
			else if (e.key.toLowerCase() === "b") setCover((c) => (c === "black" ? null : "black"));
			else if (e.key.toLowerCase() === "w") setCover((c) => (c === "white" ? null : "white"));
			else if (/^\d$/.test(e.key)) setTyped((t) => (t + e.key).slice(0, 3));
			else if (e.key === "Enter") {
				if (typed) setI(Math.max(0, Math.min(list.length - 1, Number(typed) - 1)));
				else go(1);
				setTyped("");
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [go, onClose, list.length, typed]);

	const [screen, setScreen] = useState({ w: window.innerWidth, h: window.innerHeight });
	useEffect(() => {
		const on = () => setScreen({ w: window.innerWidth, h: window.innerHeight });
		window.addEventListener("resize", on);
		return () => window.removeEventListener("resize", on);
	}, []);

	const here = useBox();
	const next = list[i + 1] ?? null;
	const nextBox = useBox();

	// One screen, no presenter view: the slide alone
	if (!presenterView || audience === "failed") {
		return (
			<div role="dialog" aria-label="Slide show" className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: cover === "white" ? "#fff" : "#000" }} onClick={() => go(1)}>
				{!cover && <Fitted doc={doc} k={key} baseId={baseId} reregister={reregister} box={screen} slideSize={slideSize} className={moves ? "animate-in fade-in duration-500" : undefined} />}
				<span className="pointer-events-none absolute right-3 bottom-2 font-mono text-xs text-white/50">
					{typed ? `Go to ${typed}` : `${i + 1} / ${list.length}`}
				</span>
				{presenterView && audience === "failed" && <span className="pointer-events-none absolute bottom-2 left-3 text-xs text-white/50">The second window could not open, so the show is on this screen only.</span>}
				<button type="button" aria-label="End the show" onClick={(e) => { e.stopPropagation(); onClose(); }} className="absolute top-3 right-3 text-white/50 hover:text-white">
					<X className="size-5" />
				</button>
			</div>
		);
	}

	return (
		<div role="dialog" aria-label="Presenter view" className="fixed inset-0 z-50 flex flex-col bg-neutral-950 text-neutral-100">
			<header className="flex items-center gap-4 border-b border-white/10 px-4 py-2 text-sm">
				<span className="font-mono text-2xl tabular-nums">{clock(now - began.current)}</span>
				<span className="text-neutral-400">{new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
				<span className="flex-1 text-center text-neutral-300">
					Slide {i + 1} of {list.length}
					{typed && <span className="ml-3 text-amber-300">Go to {typed}, then Enter</span>}
				</span>
				<span className="flex items-center gap-1 text-xs text-neutral-400">
					<Monitor className="size-4" />
					{audience === "opening" ? "Opening the audience window…" : "Audience window is showing the slide"}
				</span>
				<Button size="sm" variant="outline" onPress={() => setCover((c) => (c === "black" ? null : "black"))} aria-pressed={cover === "black"}>
					Black Screen
				</Button>
				<Button size="sm" variant="destructive" onPress={onClose}>
					<X className="size-4" />
					End Show
				</Button>
			</header>
			<div className="flex min-h-0 flex-1 gap-4 p-4">
				<div className="flex min-w-0 flex-[3] flex-col gap-3">
					<div ref={here.ref} className="relative flex min-h-0 flex-1 items-center justify-center">
						<Fitted doc={doc} k={key} baseId={baseId} reregister={reregister} box={here.size} slideSize={slideSize} />
						{cover && <span className="absolute top-2 left-2 bg-black/70 px-2 py-0.5 text-xs">The audience sees a {cover} screen</span>}
					</div>
					<div className="flex items-center justify-center gap-3">
						<Button variant="outline" size="sm" isDisabled={i === 0} onPress={() => go(-1)}>
							<ChevronLeft className="size-4" />
							Previous
						</Button>
						<Button size="sm" isDisabled={i >= list.length - 1} onPress={() => go(1)}>
							Next
							<ChevronRight className="size-4" />
						</Button>
					</div>
				</div>
				<aside className="flex min-w-0 flex-[2] flex-col gap-3">
					<div>
						<p className="mb-1 text-xs text-neutral-400">{next ? "Next" : "End of the show"}</p>
						<div ref={nextBox.ref} className="flex aspect-video w-full items-center justify-center bg-neutral-900">
							{next && <Fitted doc={doc} k={next} baseId={baseId} reregister={reregister} box={nextBox.size} slideSize={slideSize} />}
						</div>
					</div>
					<div className="flex min-h-0 flex-1 flex-col">
						<div className="mb-1 flex items-center gap-2 text-xs text-neutral-400">
							<span className="flex-1">Notes</span>
							<button type="button" aria-label="Smaller notes" onClick={() => setNoteSize((s) => Math.max(12, s - 2))} className="p-1 hover:text-white">
								<Minus className="size-3.5" />
							</button>
							<button type="button" aria-label="Larger notes" onClick={() => setNoteSize((s) => Math.min(48, s + 2))} className="p-1 hover:text-white">
								<Plus className="size-3.5" />
							</button>
						</div>
						<div className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap bg-neutral-900 p-3 leading-snug" style={{ fontSize: noteSize }}>
							{slide && notesOf(slide) ? notesOf(slide) : <span className="text-neutral-500">No notes for this slide.</span>}
						</div>
					</div>
				</aside>
			</div>
		</div>
	);
}
