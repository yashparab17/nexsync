// Collaborator colours: eight hues tuned so white initials read on them (4.5:1) and the colour itself
// holds 3:1 against both Latte's and Mocha's crust. Hex, because y-codemirror appends alpha to it for selections.
const PEER_COLORS = ["#d22d64", "#ad38d5", "#cf3a2c", "#b15825", "#896e1d", "#1c823e", "#1e7b8e", "#5a64dc"];

// Deterministic cursor color for a collaborator, derived from their display name
export function colorForName(name: string): string {
	let hash = 0;
	for (let i = 0; i < name.length; i++) {
		hash = (hash << 5) - hash + name.charCodeAt(i);
		hash |= 0;
	}
	return PEER_COLORS[Math.abs(hash) % PEER_COLORS.length];
}
