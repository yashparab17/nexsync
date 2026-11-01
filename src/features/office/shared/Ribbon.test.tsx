import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Big, Group, OfficeFrame } from "@/features/office/shared/Ribbon";
import { Copy } from "lucide-react";

afterEach(cleanup);
beforeEach(() => localStorage.clear());

function Frame() {
	const [tab, setTab] = useState("home");
	return (
		<OfficeFrame accent="powerpoint" name="Deck" tabs={[{ id: "home", label: "Home" }, { id: "insert", label: "Insert" }]} tab={tab} onTab={setTab} ribbon={<Group label={tab}><Big icon={Copy} label={`Button of ${tab}`} /></Group>}>
			<p>work area</p>
		</OfficeFrame>
	);
}

describe("the ribbon", () => {
	it("moves between tabs with the arrow keys", () => {
		render(<Frame />);
		const home = screen.getByRole("tab", { name: "Home" });
		expect(home.getAttribute("aria-selected")).toBe("true");
		fireEvent.keyDown(home, { key: "ArrowRight" });
		expect(screen.getByRole("tab", { name: "Insert" }).getAttribute("aria-selected")).toBe("true");
		expect(screen.getByRole("button", { name: "Button of insert" })).toBeTruthy();
		fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowLeft" });
		expect(home.getAttribute("aria-selected")).toBe("true");
	});

	it("collapses with Ctrl+F1 and remembers it", () => {
		const { unmount } = render(<Frame />);
		expect(screen.getByRole("button", { name: "Button of home" })).toBeTruthy();
		fireEvent.keyDown(screen.getByRole("tablist"), { key: "F1", ctrlKey: true });
		expect(screen.queryByRole("button", { name: "Button of home" })).toBeNull();
		unmount();
		render(<Frame />);
		expect(screen.queryByRole("button", { name: "Button of home" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Pin the ribbon" }));
		expect(screen.getByRole("button", { name: "Button of home" })).toBeTruthy();
	});
});
