import { beforeEach, describe, expect, it } from "vitest";

import { forgetRecent, pushRecent, readRecent, renameRecent } from "@/lib/recentFiles";

describe("recentFiles", () => {
	beforeEach(() => localStorage.clear());

	it("drops deleted files and folders and follows renames", () => {
		for (const p of ["notes/a.md", "office/documents/Plan.docx", "notes/sub/b.md", "notesx.md"]) pushRecent("/ws", p);
		forgetRecent("/ws", "/office/documents/Plan.docx");
		expect(readRecent("/ws")).toEqual(["notesx.md", "notes/sub/b.md", "notes/a.md"]);
		renameRecent("/ws", "notes", "journal");
		expect(readRecent("/ws")).toEqual(["notesx.md", "journal/sub/b.md", "journal/a.md"]);
		forgetRecent("/ws", "journal");
		expect(readRecent("/ws")).toEqual(["notesx.md"]);
	});
});
