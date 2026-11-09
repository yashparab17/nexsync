import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The header rules (see the Toolbar notes): a page's bar has no title text, its primary action is the last control, and
// the Office pages keep their list pane's search and "new" buttons in the pane's own header.
const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : f.endsWith(".tsx") && !f.endsWith(".test.tsx") ? [join(dir, f)] : []));
const pages = walk("src/features").filter((f) => /Page\.tsx$|FileBrowser\.tsx$/.test(f));

describe("workspace headers", () => {
	it("do not put a title in a page bar", () => {
		const offenders = pages.filter((f) => /<ToolbarTitle\b/.test(readFileSync(f, "utf8")) && !/ChatPage|SettingsPage/.test(f));
		expect(offenders).toEqual([]);
	});

	it("keep the Office pages' search and new buttons in the list pane", () => {
		for (const f of pages.filter((p) => /office[\/](documents|sheets|slides)[\/]\w+Page\.tsx$/.test(p))) {
			const text = readFileSync(f, "utf8");
			expect(text, f).toMatch(/<PaneHeader |<OfficeFileList /);
			expect(text, f).not.toMatch(/<Toolbar>\s*$/m);
		}
	});

	it("use the shared pieces instead of styling them again", () => {
		const all = walk("src").filter((f) => !/components[\/]ui[\/]/.test(f));
		const text = (f: string) => readFileSync(f, "utf8");
		// Icon-only buttons are IconButton; error boxes and field errors are Notice and FieldError
		expect(all.filter((f) => /<Button[^>]*size="icon-(xs|sm)"/.test(text(f)))).toEqual([]);
		expect(all.filter((f) => /<p role="alert" className="[^"]*(bg-destructive\/10|text-xs text-destructive)/.test(text(f)))).toEqual([]);
	});
});
