// Colours of people: eight hues tuned so white initials read on them (4.5:1) and the colour itself holds 3:1 against both
// Latte's and Mocha's crust. Hex, because y-codemirror appends alpha to it for selections.
//
// A colour is never worked out from a name. A person picks one (Settings, Profile) or is given one at random the first time, and
// it is shared into each workspace with their picture (src/lib/profile.ts). Someone whose device has not shared one yet shows in
// a neutral grey.
export const PALETTE = ["#d22d64", "#ad38d5", "#cf3a2c", "#b15825", "#896e1d", "#1c823e", "#1e7b8e", "#5a64dc"];

// White initials read on it (6:1)
export const NEUTRAL = "#5c6370";

export const randomColor = (): string => PALETTE[Math.floor(Math.random() * PALETTE.length)];

// Colours people chose, by lower-case name
const chosen = new Map<string, string>();
export function setChosenColors(colors: Map<string, string>): void {
	chosen.clear();
	for (const [name, color] of colors) chosen.set(name.trim().toLowerCase(), color);
}

// The colour the person with this name chose, or grey
export const colorOf = (name: string): string => chosen.get(name.trim().toLowerCase()) ?? NEUTRAL;
