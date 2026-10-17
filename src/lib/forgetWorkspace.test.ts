import { afterEach, describe, expect, it } from "vitest";

import { forgetWorkspace } from "./forgetWorkspace";

afterEach(() => localStorage.clear());

const win = (...parts: string[]) => parts.join(String.fromCharCode(92));

describe("forgetWorkspace", () => {
	it("clears what was remembered under a workspace folder and nothing else", () => {
		localStorage.setItem(`nexsync.recent.${win("C:", "Docs", "Test")}`, '["office/documents/a.docx"]');
		localStorage.setItem("nexsync.pinned-notes.C:/Docs/Test", "[]");
		localStorage.setItem(`nexsync.recent.${win("C:", "Docs", "Other")}`, "[]");
		localStorage.setItem("nexsync.theme", "dark");
		forgetWorkspace(win("C:", "Docs", "Test") + win("", ""));
		expect(Object.keys(localStorage).sort()).toEqual([`nexsync.recent.${win("C:", "Docs", "Other")}`, "nexsync.theme"]);
	});
});
