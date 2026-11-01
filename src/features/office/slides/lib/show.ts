// What the two screens of a slide show say to each other. The laptop shows the presenter view (this slide, the next one, the notes, a
// timer); a second window on the projector shows only the slide. Both are windows of the same app, so they talk through app events, and
// the audience window draws the slide itself (the deck lives in the backend, which both windows can ask).

export const SHOW_STATE = "show://state";
export const SHOW_READY = "show://ready";
export const SHOW_NAV = "show://nav";
export const SHOW_END = "show://end";
export const AUDIENCE_LABEL = "audience";

// What the audience window shows
export interface ShowState {
	baseId: string;
	// The slide as the deck holds it (JSON), drawn by the backend
	slide: string;
	index: number;
	total: number;
	widthPt: number;
	heightPt: number;
	// A black or white screen, put up by the presenter
	cover: "black" | "white" | null;
	// Whether the slide arrived with a transition
	moves: boolean;
}

// A message from the audience window: a move (by this many slides, or to a slide), or the end of the show
export interface ShowNav {
	by?: number;
	to?: number;
	cover?: "black" | "white" | null;
}

export interface MonitorLike {
	name: string | null;
	position: { x: number; y: number };
	size: { width: number; height: number };
}

// The screen for the audience: the first one that is not the one the presenter's window is on, or none when there is only one
export function pickAudienceMonitor<T extends MonitorLike>(all: T[], current: MonitorLike | null): T | null {
	if (all.length < 2) return null;
	const same = (m: MonitorLike) => !!current && m.position.x === current.position.x && m.position.y === current.position.y;
	return all.find((m) => !same(m)) ?? null;
}

// 0:07, 12:03, 1:02:09
export function clock(ms: number): string {
	const s = Math.max(0, Math.floor(ms / 1000));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const two = (n: number) => String(n).padStart(2, "0");
	return h > 0 ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`;
}

// The width, in CSS pixels, at which a slide drawn at `scale` pixels per point shows each of its pixels on one pixel of the screen. A
// picture drawn at some other size is stretched by the browser, which is what makes text look soft.
export function crisp(wanted: number, widthPt: number, dpr: number): { scale: number; width: number } {
	const scale = Math.max(0.05, Math.round(((wanted * dpr) / widthPt) * 100) / 100);
	return { scale, width: (widthPt * scale) / dpr };
}

// The size a slide gets on a screen of this size: as large as fits, keeping its shape
export function fitSlide(screen: { w: number; h: number }, widthPt: number, heightPt: number): number {
	return Math.min(screen.w, (screen.h * widthPt) / heightPt);
}
