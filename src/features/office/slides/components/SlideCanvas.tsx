import { useEffect, useRef, useState } from "react";

import { dragged, type Frame, type Handle, type Xfrm } from "@/features/office/slides/lib/deck";
import type { DeckRendered } from "@/lib/tauri";
import { cn } from "@/lib/utils";

export interface OtherSelection {
	id: number;
	name: string;
	color: string;
}

const HANDLES: { h: Handle; style: React.CSSProperties; cursor: string }[] = [
	{ h: "nw", style: { left: -4, top: -4 }, cursor: "nwse-resize" },
	{ h: "n", style: { left: "calc(50% - 4px)", top: -4 }, cursor: "ns-resize" },
	{ h: "ne", style: { right: -4, top: -4 }, cursor: "nesw-resize" },
	{ h: "e", style: { right: -4, top: "calc(50% - 4px)" }, cursor: "ew-resize" },
	{ h: "se", style: { right: -4, bottom: -4 }, cursor: "nwse-resize" },
	{ h: "s", style: { left: "calc(50% - 4px)", bottom: -4 }, cursor: "ns-resize" },
	{ h: "sw", style: { left: -4, bottom: -4 }, cursor: "nesw-resize" },
	{ h: "w", style: { left: -4, top: "calc(50% - 4px)" }, cursor: "ew-resize" },
];

// One slide, as the backend drew it, with a frame over each shape to select, move and resize. Text is typed into a box over the shape.
export default function SlideCanvas({
	image,
	displayWidth,
	selected,
	others,
	readOnly,
	text,
	onSelect,
	onBox,
	onDelete,
	onText,
	onEditing,
}: {
	image: DeckRendered;
	displayWidth: number;
	selected: number | null;
	others: OtherSelection[];
	readOnly: boolean;
	// The text of a shape, for the box typed into
	text: (id: number) => string;
	onSelect: (id: number | null) => void;
	onBox: (id: number, box: Xfrm) => void;
	onDelete: (id: number) => void;
	onText: (id: number, text: string) => void;
	onEditing?: (editing: boolean) => void;
}) {
	const k = displayWidth / image.widthPt;
	const height = image.heightPt * k;
	const [drag, setDrag] = useState<{ id: number; handle: Handle; start: { x: number; y: number }; box: Xfrm; now: Xfrm } | null>(null);
	const [typing, setTypingState] = useState<{ id: number; value: string } | null>(null);
	// The entry as the handlers see it right now: ending one must not be repeated by the blur of the box that was removed
	const typingRef = useRef<typeof typing>(null);
	const setTyping = (t: typeof typing) => {
		typingRef.current = t;
		setTypingState(t);
	};
	const root = useRef<HTMLDivElement>(null);

	useEffect(() => onEditing?.(!!typing), [typing, onEditing]);

	const frameBox = (f: Frame): Xfrm => (drag && drag.id === f.id ? drag.now : { x: f.x, y: f.y, w: f.w, h: f.h, rot: f.rot });

	const begin = (e: React.PointerEvent, f: Frame, handle: Handle) => {
		if (typing) return;
		e.stopPropagation();
		onSelect(f.id);
		if (readOnly) return;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		const box: Xfrm = { x: f.x, y: f.y, w: f.w, h: f.h, rot: f.rot };
		setDrag({ id: f.id, handle, start: { x: e.clientX, y: e.clientY }, box, now: box });
		root.current?.focus();
	};
	const move = (e: React.PointerEvent) => {
		if (!drag) return;
		const dx = (e.clientX - drag.start.x) / k;
		const dy = (e.clientY - drag.start.y) / k;
		setDrag({ ...drag, now: dragged(drag.box, drag.handle, dx, dy, e.shiftKey) });
	};
	const end = () => {
		if (!drag) return;
		const { id, box, now } = drag;
		setDrag(null);
		if (now.x !== box.x || now.y !== box.y || now.w !== box.w || now.h !== box.h) onBox(id, now);
	};

	const onKeyDown = (e: React.KeyboardEvent) => {
		if (typing || selected === null) return;
		const f = image.frames.find((x) => x.id === selected);
		if (!f) return;
		const step = e.shiftKey ? 10 : 1;
		const nudge = (dx: number, dy: number) => {
			e.preventDefault();
			if (!readOnly) onBox(f.id, { x: f.x + dx, y: f.y + dy, w: f.w, h: f.h, rot: f.rot });
		};
		if (e.key === "ArrowLeft") nudge(-step, 0);
		else if (e.key === "ArrowRight") nudge(step, 0);
		else if (e.key === "ArrowUp") nudge(0, -step);
		else if (e.key === "ArrowDown") nudge(0, step);
		else if ((e.key === "Delete" || e.key === "Backspace") && !readOnly) {
			e.preventDefault();
			onDelete(f.id);
		} else if ((e.key === "Enter" || e.key === "F2") && !readOnly) {
			e.preventDefault();
			setTyping({ id: f.id, value: text(f.id) });
		} else if (e.key === "Escape") onSelect(null);
	};

	const typed = typing ? image.frames.find((f) => f.id === typing.id) : null;
	const finish = (keep: boolean) => {
		const t = typingRef.current;
		if (!t) return;
		if (keep && t.value !== text(t.id)) onText(t.id, t.value);
		setTyping(null);
		root.current?.focus();
	};

	return (
		<div
			ref={root}
			tabIndex={0}
			aria-label="Slide"
			onKeyDown={onKeyDown}
			onPointerDown={() => {
				onSelect(null);
				root.current?.focus();
			}}
			onPointerMove={move}
			onPointerUp={end}
			className="relative shrink-0 bg-white shadow-md ring-1 ring-border outline-none focus-visible:ring-primary"
			style={{ width: displayWidth, height }}
		>
			<img src={`data:image/png;base64,${image.png}`} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full select-none" />
			{image.frames.map((f) => {
				const b = frameBox(f);
				const mine = f.id === selected;
				const theirs = others.find((o) => o.id === f.id);
				return (
					<div
						key={f.id}
						data-frame={f.id}
						onPointerDown={(e) => begin(e, f, "move")}
						onDoubleClick={() => !readOnly && setTyping({ id: f.id, value: text(f.id) })}
						className={cn("absolute touch-none", !readOnly && "cursor-move", mine ? "outline outline-2 outline-primary" : "hover:outline hover:outline-1 hover:outline-primary/50")}
						style={{ left: b.x * k, top: b.y * k, width: b.w * k, height: b.h * k, transform: b.rot ? `rotate(${b.rot}deg)` : undefined, ...(theirs ? { outline: `2px solid ${theirs.color}` } : {}) }}
					>
						{theirs && !mine && (
							<span className="absolute -top-4 left-0 px-1 text-[11px] leading-4 text-white" style={{ background: theirs.color }}>
								{theirs.name}
							</span>
						)}
						{mine && !readOnly && !typing && f.kind !== "table" && HANDLES.map((hd) => <span key={hd.h} onPointerDown={(e) => begin(e, f, hd.h)} className="absolute size-2 border border-primary bg-background" style={{ ...hd.style, cursor: hd.cursor }} />)}
					</div>
				);
			})}
			{typing && typed && (
				<textarea
					autoFocus
					aria-label="Text of the shape"
					value={typing.value}
					onChange={(e) => setTyping({ ...typing, value: e.target.value })}
					onBlur={() => finish(true)}
					onKeyDown={(e) => {
						e.stopPropagation();
						if (e.key === "Escape") finish(false);
						else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) finish(true);
					}}
					className="absolute resize-none bg-white/90 p-1 text-black outline outline-2 outline-primary"
					style={{ left: typed.x * k, top: typed.y * k, width: typed.w * k, height: Math.max(typed.h * k, 40), fontSize: Math.max(11, 18 * k) }}
				/>
			)}
		</div>
	);
}
