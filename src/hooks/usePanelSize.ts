import { useCallback, useState } from "react";

// A panel size in pixels that is remembered on this device
export function usePanelSize(key: string, initial: number, min: number, max: number) {
	const storageKey = `nexsync.panel.${key}`;
	const [size, setSize] = useState(() => {
		try {
			const saved = Number(localStorage.getItem(storageKey));
			return Number.isFinite(saved) && saved > 0 ? Math.min(max, Math.max(min, saved)) : initial;
		} catch {
			return initial;
		}
	});
	const set = useCallback(
		(next: number) => {
			const clamped = Math.min(max, Math.max(min, Math.round(next)));
			setSize(clamped);
			try {
				localStorage.setItem(storageKey, String(clamped));
			} catch {
				// Not remembered this time
			}
		},
		[storageKey, min, max],
	);
	return [size, set] as const;
}

// The left panel of Notes and of the Editor (note list, file tree): one width for both, so moving between the two pages
// never changes it. Double-clicking the edge puts it back to the usual width.
const SIDE_PANEL = { initial: 300, min: 220, max: 520 };
export function useSidePanelWidth() {
	const [width, setWidth] = usePanelSize("side-panel", SIDE_PANEL.initial, SIDE_PANEL.min, SIDE_PANEL.max);
	return [width, (next: number) => setWidth(next === 0 ? SIDE_PANEL.initial : next)] as const;
}
