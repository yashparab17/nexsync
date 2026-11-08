import { act, renderHook } from "@testing-library/react";
import * as Y from "yjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

let role = "Editor";
vi.mock("@/store/chat/ChatContext", () => ({ useChat: () => ({ role }) }));

import { useDocumentAccess } from "./useDocumentAccess";

const editor = { readOnly: false, canComment: true };
beforeEach(() => {
	role = "Editor";
});

describe("useDocumentAccess", () => {
	it("restricts an Editor when an Admin sets it, on every device", () => {
		const doc = new Y.Doc();
		const { result } = renderHook(() => useDocumentAccess(doc, editor));
		expect(result.current.readOnly).toBe(false);
		act(() => doc.getMap("docSettings").set("restrict", "comments"));
		expect(result.current).toMatchObject({ readOnly: true, canComment: true, restricted: true, canSetRules: false });
	});

	it("never restricts an Admin, and lets them set the rules and lock sections", () => {
		role = "Admin";
		const doc = new Y.Doc();
		const { result } = renderHook(() => useDocumentAccess(doc, editor));
		act(() => result.current.setRestriction("read"));
		expect(result.current).toMatchObject({ restriction: "read", readOnly: false, restricted: false, canSetRules: true });
		act(() => result.current.toggleSectionLock("s1"));
		expect(result.current.lockedKeys).toEqual(["s1"]);
		act(() => result.current.toggleSectionLock("s1"));
		expect(result.current.lockedKeys).toEqual([]);
	});

	it("ignores a restriction or lock list it cannot read", () => {
		const doc = new Y.Doc();
		doc.getMap("docSettings").set("restrict", "lock");
		doc.getMap("docSettings").set("lockedSections", "{nope");
		const { result } = renderHook(() => useDocumentAccess(doc, editor));
		expect(result.current).toMatchObject({ restriction: "none", lockedKeys: [] });
	});
});
