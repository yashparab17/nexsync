import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import EmojiPicker, { loadEmoji, searchEmoji } from "@/components/elements/EmojiPicker";
import { previewPath } from "@/components/dialogs/workspace/CreateWorkspaceDialog";

afterEach(cleanup);

describe("the emoji picker", () => {
	it("holds every category, only emoji that fit an icon, and finds them by name or search word", async () => {
		const groups = await loadEmoji();
		expect(groups.map((g) => g.id)).toEqual(expect.arrayContaining(["people", "nature", "foods", "activity", "places", "objects", "symbols", "flags"]));
		expect(groups.flatMap((g) => g.emoji).length).toBeGreaterThan(1200);
		expect(searchEmoji(groups, "rocket").map((e) => e.glyph)).toContain("🚀");
		expect(searchEmoji(groups, "red heart").length).toBeGreaterThan(0);
		expect(searchEmoji(groups, "   ")).toEqual([]);
	});

	it("picks the emoji pressed, and searches", async () => {
		const onPick = vi.fn();
		render(<EmojiPicker value={null} onPick={onPick} />);
		await waitFor(() => expect(screen.queryByText("Loading…")).toBeNull());
		fireEvent.change(screen.getByLabelText("Search emoji"), { target: { value: "rocket" } });
		fireEvent.click(screen.getByRole("button", { name: "Rocket" }));
		expect(onPick).toHaveBeenCalledWith("🚀");
	});
});

describe("the preview of where a workspace goes", () => {
	it("uses one kind of slash, the one the chosen folder uses", () => {
		expect(previewPath("E:\\nexsynctest", "test")).toBe("E:\\nexsynctest\\test");
		expect(previewPath("E:\\Work\\", "My notes")).toBe("E:\\Work\\My notes");
		expect(previewPath("/home/sam/Documents/", "test")).toBe("/home/sam/Documents/test");
	});
});
