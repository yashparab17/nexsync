import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import DocumentInspector from "@/features/office/documents/components/DocumentInspector";
import type { OfficeInspect } from "@/features/office/types";

const base: OfficeInspect = { words: 120, images: 1, comments: 2, revisions: 3, people: ["Ana"], title: "T", created: "", modified: "", macros: false, embedded: [], external: [], leftOut: [] };

afterEach(cleanup);

describe("what a document holds before it is shared", () => {
	it("counts hidden words and shows the start of the hidden text", () => {
		render(<DocumentInspector inspect={{ ...base, hiddenWords: 5, hidden: ["draft price 4,200"] }} />);
		expect(screen.getByText("Hidden words").nextSibling?.textContent).toBe("5");
		expect(screen.getByText("Hidden text")).toBeTruthy();
		expect(screen.getByText("draft price 4,200")).toBeTruthy();
		expect(screen.getByText(/stays in the file when it is shared/)).toBeTruthy();
	});

	it("says nothing about hidden text when there is none", () => {
		render(<DocumentInspector inspect={base} />);
		expect(screen.getByText("Hidden words").nextSibling?.textContent).toBe("0");
		expect(screen.queryByText("Hidden text")).toBeNull();
	});
});
