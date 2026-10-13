// Whether the terminal-style touches (scanlines, blinking cursors) are drawn. On by default; see index.css.
const KEY = "effects";

export function readEffects(): boolean {
	try {
		return localStorage.getItem(KEY) !== "off";
	} catch {
		return true;
	}
}

export function setEffects(on: boolean) {
	document.documentElement.dataset.effects = on ? "on" : "off";
	try {
		localStorage.setItem(KEY, on ? "on" : "off");
	} catch {
		// Applied for this session only
	}
}
