// Fills an empty shared text from the file on disk, the same way on every device.
//
// Two devices that open a file for the first time each find the shared text empty and each fill it from their own copy.
// With random client ids those are two different insertions, and merging keeps both, so the text is doubled. Here the
// insertion is made by a client id taken from the text itself, so the same file gives the same operation on every
// device and merging them changes nothing, while different files give different operations and both are kept.

import * as Y from "yjs";

// A 32-bit FNV-1a hash of the text, kept away from 0 and from the small ids Yjs hands out
function clientIdFor(text: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return (h | 0x80000000) >>> 0;
}

// Puts `text` into the empty shared text; does nothing when it already holds something
export function seedText(doc: Y.Doc, text: string, key = "content"): void {
	if (!text || doc.getText(key).length > 0) return;
	const seed = new Y.Doc();
	seed.clientID = clientIdFor(text);
	seed.getText(key).insert(0, text);
	Y.applyUpdate(doc, Y.encodeStateAsUpdate(seed));
	seed.destroy();
}
