// Print Layout: the pages as they print, drawn by WordCraft's layout engine from the document as it is now. Page breaks, centred text,
// headers, footers and tables of contents come from the same code that writes the PDF. The document is laid out once, which is the slow
// part, and each page is drawn only when it comes into view, so a long file opens at once. It is read-only and laid out again shortly after
// anyone changes the text; "Edit Layout" is where the typing happens.

import { useEffect, useRef, useState } from "react";

import Loading from "@/components/Loading";
import type { OfficeLayout } from "@/features/office/types";
import { officeLayout, officePage } from "@/lib/tauri";
import { errorText } from "@/lib/utils";

const SCALE = 1.5;
const PX = 96 / 72;

export default function PrintView({ getHtml, subscribe, title, layout, sourceId, zoom, onPages }: { getHtml: () => string; subscribe: (cb: () => void) => () => void; title: string; layout: OfficeLayout; sourceId?: string | null; zoom: number; onPages?: (n: number) => void }) {
	const [list, setList] = useState<{ session: number; sizes: [number, number][] } | null>(null);
	// Pictures of pages by number; those of an earlier layout stay until the new one is drawn
	const [images, setImages] = useState<Record<number, { png: string; session: number }>>({});
	const [error, setError] = useState("");
	const asked = useRef(0);
	const layoutKey = JSON.stringify(layout);

	useEffect(() => {
		let timer: number | undefined;
		const lay = () => {
			const n = ++asked.current;
			officeLayout(getHtml(), title, layout, sourceId)
				.then((l) => {
					if (n !== asked.current) return;
					setList(l);
					setError("");
					onPages?.(l.sizes.length);
				})
				.catch((e) => n === asked.current && setError(errorText(e, "The pages could not be laid out.")));
		};
		const soon = () => {
			window.clearTimeout(timer);
			timer = window.setTimeout(lay, 700);
		};
		lay();
		const off = subscribe(soon);
		return () => {
			off();
			window.clearTimeout(timer);
			asked.current++;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [layoutKey, title, sourceId]);

	const wanted = useRef(new Set<number>());
	useEffect(() => {
		wanted.current.clear();
	}, [list?.session]);
	const draw = (index: number) => {
		if (!list) return;
		const session = list.session;
		const key = session * 100000 + index;
		if (wanted.current.has(key)) return;
		wanted.current.add(key);
		officePage(session, index, SCALE)
			.then((p) => setImages((cur) => ({ ...cur, [index]: { png: p.png, session } })))
			.catch((e) => setError(errorText(e, "A page could not be drawn.")));
	};

	if (error && !list) return <p role="alert" className="m-6 max-w-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>;
	if (!list) return <Loading className="h-48" />;
	return (
		<div className="flex flex-wrap justify-center gap-4 p-6" style={{ zoom: zoom / 100 }} aria-label="Pages">
			{error && <p role="alert" className="w-full bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}
			{list.sizes.map(([w, h], i) => (
				<Page key={i} index={i} width={w * PX} height={h * PX} image={images[i]?.png} fresh={images[i]?.session === list.session} session={list.session} onVisible={() => draw(i)} total={list.sizes.length} />
			))}
		</div>
	);
}

// One page: its blank sheet at once, its picture when it is near the screen
function Page({ index, width, height, image, fresh, session, onVisible, total }: { index: number; session: number; width: number; height: number; image?: string; fresh: boolean; onVisible: () => void; total: number }) {
	const box = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const el = box.current;
		if (!el) return;
		if (typeof IntersectionObserver === "undefined") return onVisible();
		const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && onVisible(), { rootMargin: "800px 0px" });
		io.observe(el);
		return () => io.disconnect();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [width, height, fresh, session]);
	return (
		<div ref={box} data-page={index + 1} role="img" aria-label={`Page ${index + 1} of ${total}`} className="relative bg-white shadow-md ring-1 ring-black/10" style={{ width, height }}>
			{image && <img src={`data:image/png;base64,${image}`} alt="" draggable={false} className={fresh ? "block h-full w-full" : "block h-full w-full opacity-70"} />}
		</div>
	);
}
