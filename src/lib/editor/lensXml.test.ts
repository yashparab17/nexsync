import * as Y from "yjs";
import { describe, expect, it } from "vitest";

import { recordAuthor } from "@/lib/editor/blame";
import { mergeSpotsXml, xmlRuns } from "@/lib/editor/lensXml";

// A note's text is a tree: a block group holding blocks, each holding a paragraph with its text
function paragraph(doc: Y.Doc, text: string) {
	const frag = doc.getXmlFragment("blocknote");
	const group = new Y.XmlElement("blockGroup");
	const container = new Y.XmlElement("blockContainer");
	const p = new Y.XmlElement("paragraph");
	const t = new Y.XmlText(text);
	p.insert(0, [t]);
	container.insert(0, [p]);
	group.insert(0, [container]);
	frag.insert(0, [group]);
	return t;
}

function pair() {
	const a = new Y.Doc();
	const b = new Y.Doc();
	a.clientID = 1;
	b.clientID = 2;
	recordAuthor(a, "Ana");
	recordAuthor(b, "Ben");
	const sync = () => {
		Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
		Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
	};
	return { a, b, sync };
}

describe("merge lens on rich text", () => {
	it("places text where the editor does, counting each block's opening and closing", () => {
		const doc = new Y.Doc();
		paragraph(doc, "hello");
		const { runs, blocks } = xmlRuns(doc.getXmlFragment("blocknote"));
		// blockGroup, blockContainer and paragraph are each opened once before the text
		expect(runs.map((r) => [r.from, r.to])).toEqual([[3, 8]]);
		expect(blocks).toEqual([{ from: 2, to: 9, client: doc.clientID }]);
	});

	it("finds where two people wrote in the same spot while apart", () => {
		const { a, b, sync } = pair();
		paragraph(a, "hello world");
		sync();
		const ta = a.getXmlFragment("blocknote").toString();
		expect(ta).toContain("hello world");
		const textOf = (d: Y.Doc) => ((d.getXmlFragment("blocknote").get(0) as Y.XmlElement).get(0) as Y.XmlElement).get(0) as Y.XmlElement;
		const xa = textOf(a).get(0) as Y.XmlText;
		const xb = textOf(b).get(0) as Y.XmlText;
		xa.insert(5, " big");
		xb.insert(5, " small");
		sync();
		const spots = mergeSpotsXml(a.getXmlFragment("blocknote"), a.getMap("authors"));
		expect(spots).toHaveLength(1);
		expect(spots[0].authors.sort()).toEqual(["Ana", "Ben"]);
	});
});
