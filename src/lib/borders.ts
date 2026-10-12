// Whether boxes draw a border. Off by default: the fill tells them apart, and only separating lines stay (see index.css).
const KEY = "borders";

export function readBorders(): boolean {
	try {
		return localStorage.getItem(KEY) === "on";
	} catch {
		return false;
	}
}

export function setBorders(on: boolean) {
	document.documentElement.dataset.borders = on ? "on" : "off";
	try {
		localStorage.setItem(KEY, on ? "on" : "off");
	} catch {
		// Applied for this session only
	}
}
