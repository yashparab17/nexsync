import { describe, expect, it } from "vitest";
import { channelLabel, routeForChannel } from "@/features/chat/lib/routes";

describe("routeForChannel", () => {
	it("leads to a chat channel, a note, a code file, a task or a card", () => {
		expect(routeForChannel("general")).toBe("/workspace/chat?channel=general");
		expect(routeForChannel("doc:notes/plan.md")).toBe("/workspace/notes?open=notes%2Fplan.md");
		expect(routeForChannel("doc:src/app.ts")).toBe("/workspace/editor?open=src%2Fapp.ts");
		expect(routeForChannel("doc:office/sheets/q3.xlsx")).toBe("/workspace/office/sheets?open=office%2Fsheets%2Fq3.xlsx");
		expect(routeForChannel("task:t1")).toBe("/workspace/tasks?open=t1");
		expect(routeForChannel("card:c1")).toBe("/workspace/kanban?open=c1");
	});
	it("names the place", () => {
		expect(channelLabel("general")).toBe("#general");
		expect(channelLabel("doc:notes/plan.md")).toBe("plan.md");
		expect(channelLabel("task:t1")).toBe("a task");
	});
});
