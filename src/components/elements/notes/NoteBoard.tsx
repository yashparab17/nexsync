// The note board: every note is a card on one big canvas. Drag the background to pan, scroll to zoom, drag a card to
// move it for everyone, double-click a card to open the note. Other people's pointers show while they are on the board.

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ExternalLink, Link2, Trash2 } from "lucide-react";
import type { Awareness } from "y-protocols/awareness";

import PresenceDots from "@/components/elements/PresenceDots";
import { Button } from "@/components/ui/button";
import { colorForName } from "@/lib/collabColor";
import { CARD_H, CARD_W, clampZoom, summarize } from "@/lib/notes/board";
import { degrees, type GraphEdge, type NoteInfo, type Point } from "@/lib/notes/graph";
import { noteTitle } from "@/lib/notes/links";
import { cn } from "@/lib/utils";

interface View {
	x: number;
	y: number;
	zoom: number;
}

interface RemotePointer extends Point {
	name: string;
}

interface NoteBoardProps {
	notes: NoteInfo[];
	positions: Record<string, Point>;
	edges: GraphEdge[];
	activePath: string | null;
	onMove: (path: string, to: Point) => void;
	onOpen: (path: string) => void;
	onDelete?: (path: string) => void;
	viewers?: (path: string) => string[];
	awareness?: Awareness | null;
	userName: string;
	readOnly?: boolean;
}

// How far a pointer may move and still count as a click
const CLICK_SLOP = 4;

export default function NoteBoard({ notes, positions, edges, activePath, onMove, onOpen, onDelete, viewers, awareness, userName, readOnly = false }: NoteBoardProps) {
	const frame = useRef<HTMLDivElement>(null);
	const [view, setView] = useState<View>({ x: 24, y: 24, zoom: 1 });
	const viewRef = useRef(view);
	viewRef.current = view;
	const [pointers, setPointers] = useState<RemotePointer[]>([]);
	const drag = useRef<
		| { kind: "pan"; startX: number; startY: number; from: View }
		| { kind: "card"; path: string; startX: number; startY: number; from: Point; moved: boolean }
		| null
	>(null);

	const degree = useMemo(() => degrees(notes.map((n) => n.path), edges), [notes, edges]);
	const summaries = useMemo(() => new Map(notes.map((n) => [n.path, summarize(n.text)])), [notes]);

	// Scrolling zooms around the pointer, so the spot under it stays put
	useEffect(() => {
		const el = frame.current;
		if (!el) return;
		const onWheel = (e: WheelEvent) => {
			e.preventDefault();
			const rect = el.getBoundingClientRect();
			const px = e.clientX - rect.left;
			const py = e.clientY - rect.top;
			const v = viewRef.current;
			const zoom = clampZoom(v.zoom * Math.exp(-e.deltaY * 0.0015));
			const k = zoom / v.zoom;
			setView({ zoom, x: px - (px - v.x) * k, y: py - (py - v.y) * k });
		};
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => el.removeEventListener("wheel", onWheel);
	}, []);

	// Other people's pointers, from the shared document's awareness
	useEffect(() => {
		if (!awareness) return;
		const read = () => {
			const list: RemotePointer[] = [];
			awareness.getStates().forEach((state, id) => {
				const p = (state as { noteBoard?: RemotePointer }).noteBoard;
				if (id !== awareness.clientID && p && Number.isFinite(p.x) && Number.isFinite(p.y)) list.push(p);
			});
			setPointers(list);
		};
		read();
		awareness.on("change", read);
		return () => {
			awareness.off("change", read);
			awareness.setLocalStateField("noteBoard", null);
		};
	}, [awareness]);

	const lastSent = useRef(0);
	const toWorld = useCallback((clientX: number, clientY: number): Point => {
		const rect = frame.current?.getBoundingClientRect();
		const v = viewRef.current;
		return { x: (clientX - (rect?.left ?? 0) - v.x) / v.zoom, y: (clientY - (rect?.top ?? 0) - v.y) / v.zoom };
	}, []);

	const onPointerMove = (e: ReactPointerEvent) => {
		const d = drag.current;
		if (d?.kind === "pan") {
			setView({ ...d.from, x: d.from.x + e.clientX - d.startX, y: d.from.y + e.clientY - d.startY });
		} else if (d?.kind === "card" && !readOnly) {
			const dx = e.clientX - d.startX;
			const dy = e.clientY - d.startY;
			if (!d.moved && Math.hypot(dx, dy) < CLICK_SLOP) return;
			d.moved = true;
			const zoom = viewRef.current.zoom;
			onMove(d.path, { x: Math.round(d.from.x + dx / zoom), y: Math.round(d.from.y + dy / zoom) });
		}
		if (awareness && Date.now() - lastSent.current > 50) {
			lastSent.current = Date.now();
			awareness.setLocalStateField("noteBoard", { ...toWorld(e.clientX, e.clientY), name: userName });
		}
	};

	const endDrag = () => {
		drag.current = null;
	};

	const startPan = (e: ReactPointerEvent) => {
		if (e.button !== 0) return;
		e.currentTarget.setPointerCapture(e.pointerId);
		drag.current = { kind: "pan", startX: e.clientX, startY: e.clientY, from: viewRef.current };
	};

	const startCard = (e: ReactPointerEvent, path: string) => {
		if (e.button !== 0) return;
		e.stopPropagation();
		frame.current?.setPointerCapture(e.pointerId);
		drag.current = { kind: "card", path, startX: e.clientX, startY: e.clientY, from: positions[path], moved: false };
	};

	const zoomBy = (factor: number) => {
		const el = frame.current;
		if (!el) return;
		const v = viewRef.current;
		const px = el.clientWidth / 2;
		const py = el.clientHeight / 2;
		const zoom = clampZoom(v.zoom * factor);
		const k = zoom / v.zoom;
		setView({ zoom, x: px - (px - v.x) * k, y: py - (py - v.y) * k });
	};

	return (
		<div
			ref={frame}
			role="application"
			aria-label="Note board"
			className="relative h-full w-full cursor-grab touch-none overflow-hidden bg-[radial-gradient(circle,var(--border)_1px,transparent_1px)] [background-size:24px_24px] active:cursor-grabbing"
			onPointerDown={startPan}
			onPointerMove={onPointerMove}
			onPointerUp={endDrag}
			onPointerCancel={endDrag}
		>
			<div className="absolute top-0 left-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
				{/* Links between notes */}
				<svg className="pointer-events-none absolute top-0 left-0 overflow-visible" width="1" height="1" aria-hidden>
					{edges.map((e) => {
						const a = positions[e.from];
						const b = positions[e.to];
						if (!a || !b) return null;
						return (
							<line
								key={`${e.from}>${e.to}`}
								x1={a.x + CARD_W / 2}
								y1={a.y + CARD_H / 2}
								x2={b.x + CARD_W / 2}
								y2={b.y + CARD_H / 2}
								className="stroke-primary/40"
								strokeWidth={1.5}
							/>
						);
					})}
				</svg>

				{notes.map((note) => {
					const at = positions[note.path];
					if (!at) return null;
					const summary = summaries.get(note.path);
					const here = viewers?.(note.path) ?? [];
					const links = degree.get(note.path) ?? 0;
					return (
						<div
							key={note.path}
							role="button"
							tabIndex={0}
							aria-label={`Note ${noteTitle(note.name)}`}
							onPointerDown={(e) => startCard(e, note.path)}
							onDoubleClick={() => onOpen(note.path)}
							onKeyDown={(e) => e.key === "Enter" && onOpen(note.path)}
							style={{ left: at.x, top: at.y, width: CARD_W, height: CARD_H }}
							className={cn(
								"group absolute flex cursor-pointer flex-col gap-1.5 overflow-hidden border bg-card p-3 text-card-foreground shadow-sm outline-none transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring",
								activePath === note.path && "border-primary ring-1 ring-primary",
							)}
						>
							<div className="flex items-start gap-1.5">
								<h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{noteTitle(note.name)}</h3>
								<PresenceDots names={here} />
								<div className="flex shrink-0 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100" onPointerDown={(e) => e.stopPropagation()}>
									<Button variant="ghost" size="icon-xs" aria-label={`Open ${noteTitle(note.name)}`} onPress={() => onOpen(note.path)}>
										<ExternalLink className="size-3.5" />
									</Button>
									{onDelete && !readOnly && (
										<Button variant="ghost" size="icon-xs" aria-label={`Delete ${noteTitle(note.name)}`} onPress={() => onDelete(note.path)}>
											<Trash2 className="size-3.5 text-destructive" />
										</Button>
									)}
								</div>
							</div>

							{summary && summary.headings.length > 0 && (
								<ul className="space-y-0.5 border-l-2 border-primary/50 pl-2">
									{summary.headings.map((h) => (
										<li
											key={`${h.line}-${h.text}`}
											style={{ paddingLeft: (Math.min(h.level, 3) - 1) * 10 }}
											className={cn("truncate text-xs", h.level === 1 ? "font-semibold" : h.level === 2 ? "font-medium text-foreground/90" : "text-muted-foreground")}
										>
											{h.text}
										</li>
									))}
								</ul>
							)}
							<p className="line-clamp-3 flex-1 text-xs leading-relaxed text-muted-foreground">{summary?.snippet || "Empty note"}</p>

							{links > 0 && (
								<span className="flex items-center gap-1 text-xs text-muted-foreground">
									<Link2 className="size-3" />
									{links} {links === 1 ? "link" : "links"}
								</span>
							)}
						</div>
					);
				})}

				{/* Other people's pointers */}
				{pointers.map((p, i) => (
					<div key={`${p.name}-${i}`} className="pointer-events-none absolute z-10" style={{ left: p.x, top: p.y }}>
						<svg width="14" height="14" viewBox="0 0 14 14" style={{ color: colorForName(p.name) }}>
							<path d="M1 1l11 5-4.5 1.5L6 12z" fill="currentColor" />
						</svg>
						<span className="ml-3 -mt-1 inline-block px-1 text-xs font-medium text-white" style={{ background: colorForName(p.name) }}>
							{p.name}
						</span>
					</div>
				))}
			</div>

			{/* Zoom controls */}
			<div className="absolute right-3 bottom-3 flex items-center border bg-background/90 backdrop-blur-sm" onPointerDown={(e) => e.stopPropagation()}>
				<Button variant="ghost" size="icon-xs" aria-label="Zoom out" onPress={() => zoomBy(1 / 1.25)}>
					−
				</Button>
				<button type="button" className="w-12 text-center text-xs tabular-nums hover:bg-muted" onClick={() => setView({ x: 24, y: 24, zoom: 1 })} aria-label="Reset view">
					{Math.round(view.zoom * 100)}%
				</button>
				<Button variant="ghost" size="icon-xs" aria-label="Zoom in" onPress={() => zoomBy(1.25)}>
					+
				</Button>
			</div>
		</div>
	);
}
