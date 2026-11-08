// The deck as the backend holds it while it is drawn: the backend keeps the deck's base under an id and only a few at a time, so the id can
// go stale. The session registers the base, asks the backend for pictures, layouts and new slides, and registers again when the backend
// has dropped the base. Callers never see or hold the id, except `id` for the audience window, which asks the backend itself.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as Y from "yjs";

import { getBase } from "@/features/office/slides/lib/deck";
import { deckApplyLayout, deckLayouts, deckNewSlide, deckRegister, deckRender, type DeckRendered } from "@/features/office/lib/api";

export interface DeckSession {
	// The backend's name for the deck now (null until it is registered); a new session object is made when it changes
	id: string | null;
	render(slide: string, scale: number): Promise<DeckRendered>;
	layouts(): Promise<{ id: number; name: string }[]>;
	newSlide(layout: number): Promise<string>;
	applyLayout(slide: string, layout: number, firstId: number): Promise<string>;
}

const message = (e: unknown) => String((e as { message?: string })?.message ?? e);

export function useDeckSession(doc: Y.Doc, onError: (e: unknown) => void): DeckSession {
	const [id, setId] = useState<string | null>(null);
	const current = useRef<string | null>(null);
	const register = useCallback(async () => {
		const base = getBase(doc);
		if (!base) return null;
		const next = await deckRegister(base);
		current.current = next;
		setId(next);
		return next;
	}, [doc]);
	const baseText = getBase(doc);
	const failed = useRef(onError);
	failed.current = onError;
	useEffect(() => {
		if (baseText) void register().catch((e) => failed.current(e));
	}, [baseText, register]);

	// Runs a call with the deck's id; once more with a fresh one when the backend says it no longer has the base
	const call = useCallback(
		async <T>(run: (id: string) => Promise<T>): Promise<T> => {
			const now = current.current;
			if (!now) throw new Error("The deck is not ready.");
			try {
				return await run(now);
			} catch (e) {
				if (message(e) !== "unknown base") throw e;
				const fresh = await register();
				if (!fresh) throw e;
				return run(fresh);
			}
		},
		[register],
	);

	return useMemo(
		() => ({
			id,
			render: (slide, scale) => call((b) => deckRender(b, slide, scale)),
			layouts: () => call((b) => deckLayouts(b)),
			newSlide: (layout) => call((b) => deckNewSlide(b, layout)),
			applyLayout: (slide, layout, firstId) => call((b) => deckApplyLayout(b, slide, layout, firstId)),
		}),
		[id, call],
	);
}
