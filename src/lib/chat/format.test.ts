import { describe, expect, it } from "vitest";
import { parseMessage } from "./format";

const people = [{ name: "Bo", deviceId: "KEYB" }];

describe("parseMessage", () => {
	it("finds bold, italic, code, note links and mentions, and keeps the rest as text", () => {
		const [block] = parseMessage("hi <@KEYB>, **bold** and *soft* with `code` see [[Plan]]!", people);
		expect(block.type).toBe("text");
		if (block.type !== "text") return;
		expect(block.inline.map((i) => [i.type, "text" in i ? i.text : ""])).toEqual([
			["text", "hi "],
			["mention", "@Bo"],
			["text", ", "],
			["bold", "bold"],
			["text", " and "],
			["italic", "soft"],
			["text", " with "],
			["code", "code"],
			["text", " see "],
			["note", "Plan"],
			["text", "!"],
		]);
	});

	it("splits out fenced code blocks and does not format inside them", () => {
		const blocks = parseMessage("look:\n```ts\nconst **x** = 1;\n```\ndone", people);
		expect(blocks.map((b) => b.type)).toEqual(["text", "code", "text"]);
		const code = blocks[1];
		expect(code.type === "code" && code.text).toBe("const **x** = 1;");
		expect(code.type === "code" && code.lang).toBe("ts");
	});

	it("leaves markup it does not know as plain text", () => {
		const [block] = parseMessage("<script>alert(1)</script> and [a link](http://x)", people);
		expect(block.type === "text" && block.inline).toEqual([{ type: "text", text: "<script>alert(1)</script> and [a link](http://x)" }]);
	});
});

describe("task and card references", () => {
	it("reads [[task:id]] as a reference and other [[names]] as notes", () => {
		const [block] = parseMessage("see [[task:ab-12]] and [[card:c9]] and [[Plan]]", []);
		const kinds = block.type === "text" ? block.inline.map((p) => p.type) : [];
		expect(kinds).toEqual(["text", "ref", "text", "ref", "text", "note"]);
	});
});

describe("attachments", () => {
	it("reads [[file:assets/chat/name]] as an attachment and refuses other places", () => {
		const kinds = (text: string) => {
			const [block] = parseMessage(text, []);
			return block.type === "text" ? block.inline.map((p) => p.type) : [];
		};
		expect(kinds("[[file:assets/chat/ab12-photo.png]]")).toEqual(["file"]);
		expect(kinds("[[file:assets/../secret.txt]]")).toEqual(["note"]);
		expect(kinds("[[file:/etc/passwd]]")).toEqual(["note"]);
	});
});
