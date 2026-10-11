// Reads a PDF in the page itself. Web views often refuse to show a PDF inside a frame, so the pages are drawn here, one
// canvas each, and only the ones near the screen are drawn.

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";

import { Minus, Plus } from "@/components/animate-icons";
import Loading from "@/components/Loading";
import { Button } from "@/components/ui/button";
import { base64Bytes, loadPdfjs } from "@/lib/assets/previews";

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

function Page({ doc, index, width, ratio }: { doc: PDFDocumentProxy; index: number; width: number; ratio: number }) {
	const holder = useRef<HTMLDivElement>(null);
	const canvas = useRef<HTMLCanvasElement>(null);
	const [near, setNear] = useState(false);

	useEffect(() => {
		const el = holder.current;
		if (!el) return;
		const observer = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), { rootMargin: "600px 0px" });
		observer.observe(el);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		if (!near || !canvas.current || width <= 0) return;
		let cancelled = false;
		let task: { cancel: () => void; promise: Promise<unknown> } | null = null;
		void doc.getPage(index + 1).then((page) => {
			if (cancelled || !canvas.current) return;
			const natural = page.getViewport({ scale: 1 });
			const dpr = window.devicePixelRatio || 1;
			const viewport = page.getViewport({ scale: (width / natural.width) * dpr });
			const el = canvas.current;
			el.width = Math.floor(viewport.width);
			el.height = Math.floor(viewport.height);
			task = page.render({ canvas: el, canvasContext: el.getContext("2d")!, viewport });
			task.promise.catch(() => {});
		});
		return () => {
			cancelled = true;
			task?.cancel();
		};
	}, [near, doc, index, width]);

	return (
		<div ref={holder} style={{ width, height: width * ratio }} className="mx-auto mb-3 bg-white shadow-md">
			<canvas ref={canvas} aria-label={`Page ${index + 1}`} className="block h-full w-full" />
		</div>
	);
}

export default function PdfViewer({ base64, name }: { base64: string; name: string }) {
	const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [ratio, setRatio] = useState(1.3);
	const [zoom, setZoom] = useState(2);
	const scroller = useRef<HTMLDivElement>(null);
	const [available, setAvailable] = useState(0);

	useEffect(() => {
		let cancelled = false;
		let destroy: (() => void) | undefined;
		setDoc(null);
		setError(null);
		void (async () => {
			try {
				const pdfjs = await loadPdfjs();
				const task = pdfjs.getDocument({ data: await base64Bytes(base64) });
				destroy = () => void task.destroy();
				const loaded = await task.promise;
				if (cancelled) return;
				const first = (await loaded.getPage(1)).getViewport({ scale: 1 });
				setRatio(first.height / first.width);
				setDoc(loaded);
			} catch (err) {
				if (!cancelled) setError(err instanceof Error ? err.message : String(err));
			}
		})();
		return () => {
			cancelled = true;
			destroy?.();
		};
	}, [base64]);

	useEffect(() => {
		const el = scroller.current;
		if (!el) return;
		const observer = new ResizeObserver(() => setAvailable(el.clientWidth));
		observer.observe(el);
		setAvailable(el.clientWidth);
		return () => observer.disconnect();
	}, [doc, error]);

	if (error) {
		return (
			<div role="alert" className="m-auto max-w-md p-6 text-center">
				<p className="text-sm font-semibold text-destructive">This PDF could not be read</p>
				<p className="mt-1 font-mono text-xs text-destructive/80">{error}</p>
			</div>
		);
	}
	if (!doc) return <Loading className="m-auto" />;

	// "Fit" is the width of the viewer; the zoom steps are shares of that
	const factor = ZOOMS[zoom];
	const pageWidth = Math.max(120, Math.min(available - 32, 1400) * factor);
	return (
		<div className="flex h-full min-h-0 w-full flex-col">
			<div className="flex shrink-0 items-center gap-2 border-b bg-card/60 px-3 py-1.5 text-sm">
				<span className="font-mono text-xs text-muted-foreground">
					{doc.numPages} {doc.numPages === 1 ? "page" : "pages"}
				</span>
				<span className="flex-1" />
				<Button variant="ghost" size="icon-xs" aria-label="Zoom out" isDisabled={zoom === 0} onPress={() => setZoom((z) => Math.max(0, z - 1))}>
					<Minus className="size-4" />
				</Button>
				<button type="button" onClick={() => setZoom(2)} className="w-12 text-center font-mono text-xs tabular-nums outline-none hover:text-primary focus-visible:text-primary" aria-label="Fit to width">
					{Math.round(factor * 100)}%
				</button>
				<Button variant="ghost" size="icon-xs" aria-label="Zoom in" isDisabled={zoom === ZOOMS.length - 1} onPress={() => setZoom((z) => Math.min(ZOOMS.length - 1, z + 1))}>
					<Plus className="size-4" />
				</Button>
			</div>
			<div ref={scroller} className="min-h-0 flex-1 overflow-auto bg-muted/40 py-3" aria-label={`${name}, ${doc.numPages} pages`} tabIndex={0}>
				{Array.from({ length: doc.numPages }, (_, i) => (
					<Page key={i} doc={doc} index={i} width={pageWidth} ratio={ratio} />
				))}
			</div>
		</div>
	);
}
