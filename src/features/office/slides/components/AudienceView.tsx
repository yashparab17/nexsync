// The window the audience sees: only the slide, full screen, on the projector. It owns no deck; the presenter's window tells it which slide
// to show, and it draws that slide itself. Keys and clicks here move the show, so it can be run from either screen.

import { emit, listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";

import { crisp, fitSlide, SHOW_END, SHOW_NAV, SHOW_READY, SHOW_STATE, type ShowNav, type ShowState } from "@/features/office/slides/lib/show";
import { deckRender, type DeckRendered } from "@/lib/tauri";

export default function AudienceView() {
	const [state, setState] = useState<ShowState | null>(null);
	const [image, setImage] = useState<DeckRendered | null>(null);
	const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
	const dpr = window.devicePixelRatio || 1;

	useEffect(() => {
		const on = () => setSize({ w: window.innerWidth, h: window.innerHeight });
		window.addEventListener("resize", on);
		return () => window.removeEventListener("resize", on);
	}, []);

	useEffect(() => {
		let off: (() => void) | undefined;
		void listen<ShowState>(SHOW_STATE, (e) => setState(e.payload)).then((f) => {
			off = f;
			// Only now can the presenter's window be heard answering
			void emit(SHOW_READY);
		});
		return () => off?.();
	}, []);

	// Drawn at the size that fits this screen, one slide pixel to one screen pixel; the last picture stays until the next is ready
	const { scale, width } = state ? crisp(fitSlide(size, state.widthPt, state.heightPt), state.widthPt, dpr) : { scale: 1, width: 0 };
	useEffect(() => {
		if (!state || state.cover) return;
		let current = true;
		deckRender(state.baseId, state.slide, scale)
			.then((r) => current && setImage(r))
			.catch(() => {});
		return () => {
			current = false;
		};
	}, [state?.baseId, state?.slide, scale]); // eslint-disable-line react-hooks/exhaustive-deps

	useEffect(() => {
		const nav = (n: ShowNav) => void emit(SHOW_NAV, n);
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") void emit(SHOW_END);
			else if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(e.key)) nav({ by: 1 });
			else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.key)) nav({ by: -1 });
			else if (e.key.toLowerCase() === "b") nav({ cover: "black" });
			else if (e.key.toLowerCase() === "w") nav({ cover: "white" });
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	const cover = state?.cover;
	return (
		<div className="fixed inset-0 flex items-center justify-center bg-black" style={cover === "white" ? { background: "#fff" } : undefined} onClick={() => void emit(SHOW_NAV, { by: 1 } satisfies ShowNav)}>
			{!cover && image && (
				<img
					key={state?.index}
					src={`data:image/png;base64,${image.png}`}
					alt={state ? `Slide ${state.index + 1} of ${state.total}` : "Slide"}
					draggable={false}
					style={{ width }}
					className={state?.moves ? "animate-in fade-in duration-500 select-none" : "select-none"}
				/>
			)}
			{!state && <p className="text-sm text-white/50">Waiting for the presenter…</p>}
		</div>
	);
}
