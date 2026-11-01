// Every slide of the deck at once, to see the whole and drag slides into order. A press chooses a slide, a double press opens it.

import { useMemo, useState } from "react";
import * as Y from "yjs";

import { readSlide } from "@/features/office/slides/lib/deck";
import { useSlideImage } from "@/features/office/slides/lib/useSlideImage";
import { cn } from "@/lib/utils";

export default function SlideSorter({ doc, keys, current, baseId, reregister, version, readOnly, onPick, onOpen, onMove }: { doc: Y.Doc; keys: string[]; current: string; baseId: string | null; reregister: () => Promise<string | null>; version: number; readOnly: boolean; onPick: (key: string) => void; onOpen: (key: string) => void; onMove: (key: string, to: number) => void }) {
	const [drag, setDrag] = useState<string | null>(null);
	const [over, setOver] = useState<number | null>(null);
	return (
		<ol aria-label="Slide sorter" className="grid min-h-0 flex-1 grid-cols-[repeat(auto-fill,minmax(200px,1fr))] content-start gap-4 overflow-auto bg-muted/40 p-4">
			{keys.map((k, i) => (
				<li
					key={k}
					draggable={!readOnly}
					onDragStart={() => setDrag(k)}
					onDragOver={(e) => {
						if (!drag) return;
						e.preventDefault();
						setOver(i);
					}}
					onDragEnd={() => {
						setDrag(null);
						setOver(null);
					}}
					onDrop={() => {
						if (drag && drag !== k) onMove(drag, i);
						setDrag(null);
						setOver(null);
					}}
					className={cn("rounded-md", over === i && drag !== k && "ring-2 ring-primary")}
				>
					<Tile doc={doc} k={k} number={i + 1} baseId={baseId} reregister={reregister} version={version} current={k === current} onPick={() => onPick(k)} onOpen={() => onOpen(k)} />
				</li>
			))}
		</ol>
	);
}

function Tile({ doc, k, number, baseId, reregister, version, current, onPick, onOpen }: { doc: Y.Doc; k: string; number: number; baseId: string | null; reregister: () => Promise<string | null>; version: number; current: boolean; onPick: () => void; onOpen: () => void }) {
	const slide = useMemo(() => readSlide(doc, k), [doc, k, version]); // eslint-disable-line react-hooks/exhaustive-deps
	const { image } = useSlideImage(baseId, slide ? JSON.stringify(slide) : null, 0.4, reregister, 250);
	return (
		<button type="button" onClick={onPick} onDoubleClick={onOpen} onKeyDown={(e) => e.key === "Enter" && onOpen()} aria-current={current} aria-label={`Slide ${number}`} className="block w-full rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
			<span className={cn("relative block bg-white", current ? "ring-2 ring-[var(--office)]" : "ring-1 ring-border", slide?.hidden === true && "opacity-50")} style={{ aspectRatio: "16 / 9" }}>
				{image && <img src={`data:image/png;base64,${image.png}`} alt="" draggable={false} className="h-full w-full" />}
			</span>
			<span className={cn("mt-1 block text-xs", current ? "font-semibold text-[var(--office)]" : "text-muted-foreground")}>{number}</span>
		</button>
	);
}
