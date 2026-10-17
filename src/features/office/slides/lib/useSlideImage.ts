import { useEffect, useRef, useState } from "react";

import { deckRender, type DeckRendered } from "@/lib/tauri";

// A short hash of a slide's text, to find a picture already drawn
function hash(text: string): string {
	let h = 2166136261;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return (h >>> 0).toString(36) + text.length.toString(36);
}

const cache = new Map<string, DeckRendered>();
const MAX = 120;

// A slide drawn by the backend at `scale` pixels per point, again shortly after it changes. `reregister` gives the deck's base again
// when the backend no longer has it (it keeps only a few). Pictures already drawn are kept, so going back to a slide is instant.
export function useSlideImage(baseId: string | null, slide: string | null, scale: number, reregister: () => Promise<string | null>, delay = 60) {
	const [image, setImage] = useState<DeckRendered | null>(null);
	const [error, setError] = useState<string | null>(null);
	const asked = useRef(0);

	useEffect(() => {
		if (!baseId || !slide) return;
		const s = Math.round(scale * 20) / 20 || 0.05;
		const key = `${baseId}|${s}|${hash(slide)}`;
		const hit = cache.get(key);
		if (hit) {
			setImage(hit);
			setError(null);
			return;
		}
		const n = ++asked.current;
		const timer = setTimeout(async () => {
			try {
				let result: DeckRendered;
				try {
					result = await deckRender(baseId, slide, s);
				} catch (e) {
					if (String((e as { message?: string })?.message ?? e) !== "unknown base") throw e;
					const fresh = await reregister();
					if (!fresh) throw e;
					result = await deckRender(fresh, slide, s);
				}
				if (cache.size >= MAX) cache.delete(cache.keys().next().value as string);
				cache.set(key, result);
				if (n === asked.current) {
					setImage(result);
					setError(null);
				}
			} catch (e) {
				if (n === asked.current) setError(String((e as { message?: string })?.message ?? e));
			}
		}, delay);
		return () => clearTimeout(timer);
		// eslint-disable-next-line react-hooks/exhaustive-deps -- reregister is read when needed
	}, [baseId, slide, scale, delay]);

	return { image, error };
}
