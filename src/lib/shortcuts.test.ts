import { describe, expect, it } from "vitest";
import { shortcutFor } from "@/lib/shortcuts";

const press = (o: Partial<KeyboardEvent>) => shortcutFor({ key: "", code: "", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...o });

describe("workspace shortcuts", () => {
	it("jumps to pages with Alt+Shift+digit, leaving Alt+digit to the Editor tabs", () => {
		expect(press({ altKey: true, shiftKey: true, key: "!", code: "Digit2" })).toEqual({ type: "go", to: "/workspace/notes" });
		expect(press({ altKey: true, key: "2", code: "Digit2" })).toBeNull();
	});
	it("maps the VS Code style combos and ignores the Editor's own", () => {
		expect(press({ ctrlKey: true, shiftKey: true, key: "F" })).toEqual({ type: "search" });
		expect(press({ metaKey: true, key: "," })).toEqual({ type: "settings" });
		expect(press({ key: "F1" })).toEqual({ type: "help" });
		expect(press({ ctrlKey: true, key: "p" })).toBeNull();
		expect(press({ ctrlKey: true, key: "b" })).toBeNull();
	});
});
