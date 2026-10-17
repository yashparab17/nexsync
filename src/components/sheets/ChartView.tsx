import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

import { sheetChart } from "@/lib/tauri";
import type { ChartPrim, ChartSpec, SheetIn } from "@/lib/sheet";

const rgba = (c: [number, number, number, number]) => `rgba(${c[0]},${c[1]},${c[2]},${(c[3] / 255).toFixed(3)})`;
const stroke = (s: [[number, number, number, number], number] | null) => (s ? { stroke: rgba(s[0]), strokeWidth: s[1] } : {});
const pts = (list: [number, number][]) => list.map((p) => p.join(",")).join(" ");

// A pie or doughnut sector as a path; angles run clockwise from twelve o'clock
function wedge(w: Extract<ChartPrim, { Wedge: unknown }>["Wedge"]): string {
	const at = (r: number, a: number) => [w.cx + r * Math.sin(a), w.cy - r * Math.cos(a)].map((n) => n.toFixed(2));
	const large = w.a1 - w.a0 > Math.PI ? 1 : 0;
	if (w.a1 - w.a0 >= Math.PI * 2 - 1e-4) {
		const ring = (r: number) => `M${w.cx - r},${w.cy}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0`;
		return ring(w.r_outer) + (w.r_inner > 0 ? ring(w.r_inner) : "");
	}
	const [x0, y0] = at(w.r_outer, w.a0);
	const [x1, y1] = at(w.r_outer, w.a1);
	if (w.r_inner <= 0) return `M${w.cx},${w.cy}L${x0},${y0}A${w.r_outer},${w.r_outer} 0 ${large} 1 ${x1},${y1}Z`;
	const [x2, y2] = at(w.r_inner, w.a1);
	const [x3, y3] = at(w.r_inner, w.a0);
	return `M${x0},${y0}A${w.r_outer},${w.r_outer} 0 ${large} 1 ${x1},${y1}L${x2},${y2}A${w.r_inner},${w.r_inner} 0 ${large} 0 ${x3},${y3}Z`;
}

function Prims({ list }: { list: ChartPrim[] }) {
	return (
		<>
			{list.map((p, i) => {
				if ("Rect" in p) {
					const r = p.Rect;
					return <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} rx={r.radius} fill={r.fill ? rgba(r.fill) : "none"} {...stroke(r.stroke)} />;
				}
				if ("Line" in p) {
					const l = p.Line;
					return <polyline key={i} points={pts(l.pts)} fill="none" stroke={rgba(l.color)} strokeWidth={l.width} strokeDasharray={l.dash ? "4 3" : undefined} />;
				}
				if ("Polygon" in p) return <polygon key={i} points={pts(p.Polygon.pts)} fill={rgba(p.Polygon.fill)} {...stroke(p.Polygon.stroke)} />;
				if ("Wedge" in p) return <path key={i} d={wedge(p.Wedge)} fillRule="evenodd" fill={rgba(p.Wedge.fill)} {...stroke(p.Wedge.stroke)} />;
				if ("Circle" in p) return <circle key={i} cx={p.Circle.cx} cy={p.Circle.cy} r={p.Circle.r} fill={p.Circle.fill ? rgba(p.Circle.fill) : "none"} {...stroke(p.Circle.stroke)} />;
				const t = p.Text;
				return (
					<text
						key={i}
						x={t.x}
						y={t.y}
						fontSize={t.size}
						fontWeight={t.bold ? 700 : 400}
						fill={rgba(t.color)}
						textAnchor={t.align === "Center" ? "middle" : t.align === "Right" ? "end" : "start"}
						dominantBaseline={t.valign === "Middle" ? "central" : t.valign === "Top" ? "hanging" : "auto"}
						transform={t.rotation ? `rotate(${(t.rotation * 180) / Math.PI} ${t.x} ${t.y})` : undefined}
						fontFamily="Calibri, Segoe UI, sans-serif"
					>
						{t.text}
					</text>
				);
			})}
		</>
	);
}

// A chart over the cells: drawn by the engine from the range it plots, redrawn when the cells change, moved by dragging it and sized by
// its corner
export default function ChartView({
	spec,
	sheetName,
	book,
	version,
	selected,
	readOnly,
	onSelect,
	onChange,
	onRemove,
}: {
	spec: ChartSpec;
	sheetName: string;
	book: () => SheetIn[];
	// Moves when anything in the workbook changes
	version: number;
	selected: boolean;
	readOnly: boolean;
	onSelect: () => void;
	onChange: (patch: Partial<ChartSpec>) => void;
	onRemove: () => void;
}) {
	const [prims, setPrims] = useState<ChartPrim[] | null>(null);
	const [error, setError] = useState("");
	const [live, setLive] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
	const asked = useRef(0);
	const { range, kind, title } = spec;
	const w = live?.w ?? spec.w;
	const h = live?.h ?? spec.h;

	// Drawn again shortly after the last change, at the size it has when the drag is done
	useEffect(() => {
		const n = ++asked.current;
		const timer = setTimeout(() => {
			sheetChart(book(), sheetName, { range, kind, title, w: spec.w, h: spec.h })
				.then((r) => {
					if (n !== asked.current) return;
					setPrims(r);
					setError("");
				})
				.catch((e) => n === asked.current && setError(typeof e === "string" ? e : "The chart could not be drawn."));
		}, 300);
		return () => clearTimeout(timer);
	}, [book, sheetName, range, kind, title, spec.w, spec.h, version]);

	const drag = (e: React.PointerEvent, mode: "move" | "size") => {
		if (readOnly || e.button !== 0) return;
		e.stopPropagation();
		onSelect();
		const el = e.currentTarget as HTMLElement;
		el.setPointerCapture(e.pointerId);
		const start = { px: e.clientX, py: e.clientY, x: spec.x, y: spec.y, w: spec.w, h: spec.h };
		const at = (ev: PointerEvent) =>
			mode === "move"
				? { x: Math.max(0, start.x + ev.clientX - start.px), y: Math.max(0, start.y + ev.clientY - start.py), w: start.w, h: start.h }
				: { x: start.x, y: start.y, w: Math.max(160, start.w + ev.clientX - start.px), h: Math.max(110, start.h + ev.clientY - start.py) };
		const move = (ev: PointerEvent) => setLive(at(ev));
		const up = (ev: PointerEvent) => {
			el.releasePointerCapture(e.pointerId);
			el.removeEventListener("pointermove", move);
			el.removeEventListener("pointerup", up);
			setLive(null);
			const done = at(ev);
			if (done.x !== spec.x || done.y !== spec.y || done.w !== spec.w || done.h !== spec.h) onChange(done);
		};
		el.addEventListener("pointermove", move);
		el.addEventListener("pointerup", up);
	};

	return (
		<div
			role="img"
			aria-label={`${kind} chart${title ? `: ${title}` : ""} of ${range}`}
			onPointerDown={(e) => drag(e, "move")}
			onMouseDown={(e) => e.stopPropagation()}
			className={`absolute z-10 cursor-move overflow-hidden border bg-white shadow-sm ${selected ? "ring-2 ring-[var(--office)]" : ""}`}
			style={{ left: live?.x ?? spec.x, top: live?.y ?? spec.y, width: w, height: h }}
		>
			{error ? <p className="p-3 text-xs text-destructive">{error}</p> : prims ? <svg width={w} height={h} viewBox={`0 0 ${spec.w} ${spec.h}`} preserveAspectRatio="none" aria-hidden><Prims list={prims} /></svg> : null}
			{selected && !readOnly && (
				<>
					<button type="button" aria-label="Delete the chart" title="Delete the chart" onPointerDown={(e) => e.stopPropagation()} onClick={onRemove} className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-sm bg-black/60 text-white outline-none hover:bg-black/80 focus-visible:ring-2 focus-visible:ring-white">
						<X className="size-3" />
					</button>
					<span aria-hidden onPointerDown={(e) => drag(e, "size")} className="absolute right-0 bottom-0 size-3 cursor-nwse-resize bg-[var(--office)]" />
				</>
			)}
		</div>
	);
}
