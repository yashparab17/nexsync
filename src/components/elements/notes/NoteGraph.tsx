// Graph view: every note is a dot, and a [[link]] from one note to another is a line. Hovering a note lights up the
// notes it is linked to; clicking opens it.

import { useEffect, useMemo, useRef, useState } from "react";

import { degrees, graphLabel, layoutGraph, type GraphEdge, type NoteInfo } from "@/lib/notes/graph";
import { cn } from "@/lib/utils";

interface NoteGraphProps {
	notes: NoteInfo[];
	edges: GraphEdge[];
	activePath: string | null;
	onOpen: (path: string) => void;
}

export default function NoteGraph({ notes, edges, activePath, onOpen }: NoteGraphProps) {
	const frame = useRef<HTMLDivElement>(null);
	const [size, setSize] = useState({ width: 900, height: 600 });
	const [hover, setHover] = useState<string | null>(null);

	useEffect(() => {
		const el = frame.current;
		if (!el) return;
		const measure = () => setSize({ width: Math.max(el.clientWidth, 320), height: Math.max(el.clientHeight, 240) });
		measure();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		return () => observer.disconnect();
	}, []);

	const paths = useMemo(() => notes.map((n) => n.path), [notes]);
	const points = useMemo(() => layoutGraph(paths, edges, size.width, size.height), [paths, edges, size]);
	const degree = useMemo(() => degrees(paths, edges), [paths, edges]);
	const names = useMemo(() => new Map(notes.map((n) => [n.path, graphLabel(n)])), [notes]);

	// The notes one link away from the hovered one
	const near = useMemo(() => {
		const set = new Set<string>();
		if (!hover) return set;
		for (const e of edges) {
			if (e.from === hover) set.add(e.to);
			if (e.to === hover) set.add(e.from);
		}
		return set;
	}, [hover, edges]);

	return (
		<div ref={frame} className="relative h-full w-full overflow-hidden bg-[radial-gradient(circle,var(--border)_1px,transparent_1px)] [background-size:24px_24px]">
			<svg width={size.width} height={size.height} role="img" aria-label="Graph of linked notes">
				{edges.map((e) => {
					const a = points.get(e.from);
					const b = points.get(e.to);
					if (!a || !b) return null;
					const lit = hover === e.from || hover === e.to;
					return <line key={`${e.from}>${e.to}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={lit ? "stroke-primary" : "stroke-muted-foreground/40"} strokeWidth={lit ? 2 : 1.25} />;
				})}
				{notes.map((note) => {
					const p = points.get(note.path);
					if (!p) return null;
					const radius = 6 + Math.min(degree.get(note.path) ?? 0, 8) * 1.5;
					const dim = hover !== null && hover !== note.path && !near.has(note.path);
					return (
						<g
							key={note.path}
							transform={`translate(${p.x} ${p.y})`}
							className={cn("cursor-pointer outline-none transition-opacity", dim && "opacity-30")}
							role="button"
							tabIndex={0}
							aria-label={`Open ${names.get(note.path)}`}
							onMouseEnter={() => setHover(note.path)}
							onMouseLeave={() => setHover(null)}
							onFocus={() => setHover(note.path)}
							onBlur={() => setHover(null)}
							onClick={() => onOpen(note.path)}
							onKeyDown={(e) => e.key === "Enter" && onOpen(note.path)}
						>
							<circle r={radius} className={cn("stroke-background", activePath === note.path || hover === note.path ? "fill-primary" : "fill-primary/60")} strokeWidth={2} />
							<text y={radius + 14} textAnchor="middle" className="fill-foreground text-xs">
								{names.get(note.path)}
							</text>
						</g>
					);
				})}
			</svg>
			{notes.length > 0 && edges.length === 0 && (
				<p className="pointer-events-none absolute right-0 bottom-4 left-0 text-center text-xs text-muted-foreground">
					No links yet. Write [[Note name]] inside a note to link it to another.
				</p>
			)}
		</div>
	);
}
