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
