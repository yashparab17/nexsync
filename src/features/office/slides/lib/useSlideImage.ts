import { useEffect, useRef, useState } from "react";

import type { DeckSession } from "@/features/office/slides/lib/useDeckSession";
import type { DeckRendered } from "@/features/office/lib/api";

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

// A slide drawn by the backend at `scale` pixels per point, again shortly after it changes. Pictures already drawn are kept, so going
// back to a slide is instant.
export function useSlideImage(deck: DeckSession | null, slide: string | null, scale: number, delay = 60) {
	const [image, setImage] = useState<DeckRendered | null>(null);
	const [error, setError] = useState<string | null>(null);
	const asked = useRef(0);

	useEffect(() => {
		if (!deck?.id || !slide) return;
		// To the hundredth: a coarser step would draw the slide a little off the size it is shown at, and the browser would stretch it
		const s = Math.round(scale * 100) / 100 || 0.05;
		const key = `${deck.id}|${s}|${hash(slide)}`;
		const hit = cache.get(key);
		if (hit) {
			setImage(hit);
			setError(null);
			return;
		}
		const n = ++asked.current;
		const timer = setTimeout(async () => {
			try {
				const result = await deck.render(slide, s);
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
	}, [deck, slide, scale, delay]);

	return { image, error };
}
