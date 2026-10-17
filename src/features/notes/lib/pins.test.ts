import { beforeEach, describe, expect, it } from "vitest";

import { readPins, writePins } from "@/features/notes/lib/pins";

beforeEach(() => localStorage.clear());

describe("pinned notes", () => {
	it("are remembered per workspace", () => {
		writePins("/a", ["/notes/x.txt"]);
		expect(readPins("/a")).toEqual(["/notes/x.txt"]);
		expect(readPins("/b")).toEqual([]);
	});

	it("ignore anything that is not a list of paths", () => {
		localStorage.setItem("nexsync.pinned-notes./a", '{"no":1}');
		expect(readPins("/a")).toEqual([]);
		localStorage.setItem("nexsync.pinned-notes./a", '["/x", 3]');
		expect(readPins("/a")).toEqual(["/x"]);
	});
});
